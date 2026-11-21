// Caso de uso: comprobar que el usuario tiene vigente un consentimiento OBLIGATORIO antes de dejarlo seguir
// (p. ej. antes de acceder a datos de terceros). Si no lo tiene, la operación se corta y queda registrado
// como falla de cumplimiento.
//
// Para exigir varios consentimientos en un solo envío (y responder todas las faltas juntas), valídalos en el
// caso de uso de esa operación en vez de encadenar varias verificaciones.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { ConsentRequiredError, ConsentTypeNotConfiguredError, OptionalConsentGateError } from '../../domain/errors';
import { USER_CONSENT_AUDIT_ENTITY } from './legal-audit';

const { entityType } = USER_CONSENT_AUDIT_ENTITY;

/** Lo lanza execute() si se exige un tipo opcional: error de configuración de quien llama (no del usuario). */
export { OptionalConsentGateError };

export class VerifyConsent {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly userConsents: UserConsentRepository,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ userId, consentTypeCode }: { userId: string; consentTypeCode: string }): Promise<void> {
    const type = await this.consentTypes.findActiveByCode(consentTypeCode);
    if (!type) {
      this.logger.warn('VerifyConsent: tipo de consentimiento no configurado', { consentTypeCode, userId });
      await this.audit.record('CONSENT_VERIFIED_FAIL', {
        actorId: userId,
        details: { reason: 'consent_type_not_found', consentTypeCode },
        entityType,
        outcome: 'failure'
      });
      throw new ConsentTypeNotConfiguredError(consentTypeCode);
    }

    try {
      type.assertCanGateAccess();
    } catch (error) {
      if (error instanceof OptionalConsentGateError) {
        this.logger.error('VerifyConsent: uso incorrecto — se exige un tipo opcional', { consentTypeCode });
      }
      throw error;
    }

    const current = await this.userConsents.findCurrentByUserAndType(userId, type.consentTypeId);
    if (!current?.isInForce()) {
      await this.audit.record('CONSENT_VERIFIED_FAIL', {
        actorId: userId,
        details: { reason: 'no_valid_consent', consentTypeCode, consentTypeId: type.consentTypeId },
        entityType,
        outcome: 'failure'
      });
      throw new ConsentRequiredError(consentTypeCode);
    }

    await this.audit.record('CONSENT_VERIFIED_OK', {
      actorId: userId,
      details: { consentTypeCode, consentTypeId: type.consentTypeId },
      entityType,
      entityId: current.userConsentId
    });
  }
}
