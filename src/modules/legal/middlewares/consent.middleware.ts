import type { NextFunction, Request, Response } from 'express';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import userConsentRepository from '../repositories/user-consent.repository';
import consentTypeRepository from '../repositories/consent-type.repository';
import auditModule from '../../audit';
const { audit } = auditModule;

// Nota: para gatear una operación por un consentimiento OBLIGATORIO, usa requireConsent() como middleware
// de ruta. Si tu dominio necesita exigir varios consentimientos en un solo submit (acumular todas las
// faltas en una respuesta 422 en vez de fallar de a una), valídalos directamente en el service en lugar
// de encadenar varios middlewares.

class ConsentMiddleware {
  /**
   * Verifica que el usuario autenticado tenga un consentimiento válido y vigente
   * para el tipo indicado antes de permitir el acceso a datos de terceros.
   *
   * Si no existe, detiene el proceso y registra un error de compliance en auditoría.
   *
   * @param {string} consentTypeCode — código del tipo (ej: 'PRIVACY_POLICY')
   */
  static requireConsent(consentTypeCode: string) {
    return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
      const userId = req.user?.userId;
      if (!userId) {
        throw AppError.unauthorized('Token requerido');
      }

      const consentType = await consentTypeRepository.findByCode(consentTypeCode);
      if (!consentType) {
        logger.warn('ConsentMiddleware: tipo de consentimiento no configurado', { consentTypeCode, userId });
        await audit.record('CONSENT_VERIFIED_FAIL', {
          actorId: userId,
          details: { reason: 'consent_type_not_found', consentTypeCode },
          entityType: 'UserConsent',
          outcome: 'failure'
        });
        throw AppError.forbidden(`El tipo de consentimiento "${consentTypeCode}" no está configurado`, {
          code: 'CONSENT_TYPE_NOT_FOUND'
        });
      }

      // Ley 1581/2012 — un consentimiento opcional NUNCA puede ser condición de acceso
      if (!consentType.isMandatory) {
        logger.error('ConsentMiddleware: uso incorrecto — requireConsent() con tipo opcional', { consentTypeCode });
        throw AppError.internal(
          `ConsentMiddleware.requireConsent() no puede usarse con el tipo opcional "${consentTypeCode}". ` +
            'Los consentimientos opcionales no pueden ser condición de acceso al servicio.',
          { code: 'CONSENT_MIDDLEWARE_MISCONFIGURATION' }
        );
      }

      const existing = await userConsentRepository.findCurrentByUserAndType(userId, consentType.consentTypeId);
      const isValid = existing && !existing.revokedAt;

      if (!isValid) {
        await audit.record('CONSENT_VERIFIED_FAIL', {
          actorId: userId,
          details: {
            reason: 'no_valid_consent',
            consentTypeCode,
            consentTypeId: consentType.consentTypeId
          },
          entityType: 'UserConsent',
          outcome: 'failure'
        });
        throw AppError.forbidden('No se encontró un consentimiento válido y vigente para continuar con esta operación', {
          code: 'CONSENT_REQUIRED',
          consentTypeCode
        });
      }

      await audit.record('CONSENT_VERIFIED_OK', {
        actorId: userId,
        details: { consentTypeCode, consentTypeId: consentType.consentTypeId },
        entityType: 'UserConsent',
        entityId: existing?.userConsentId
      });

      next();
    });
  }
}

export default ConsentMiddleware;
