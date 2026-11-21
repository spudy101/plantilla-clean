import type { RequestAuditContext } from '../../../shared/types/audit-context';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import unitOfWork from '../../../shared/database/unit-of-work';
import consentTypeRepository from '../repositories/consent-type.repository';
import userConsentRepository from '../repositories/user-consent.repository';
import userConsentDtoModule from '../responses/user-consent.response';
const { MyConsentCatalogDTO, ConsentGrantedDTO } = userConsentDtoModule;
import auditModule from '../../audit';
const { audit } = auditModule;

class UserConsentService {
  unitOfWork: typeof unitOfWork;
  consentTypeRepository: typeof consentTypeRepository;
  userConsentRepository: typeof userConsentRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new UserConsentService({ unitOfWork: fake })
   * @param {object} [deps]
   */
  constructor(deps: UserConsentService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.consentTypeRepository = deps.consentTypeRepository ?? consentTypeRepository;
    this.userConsentRepository = deps.userConsentRepository ?? userConsentRepository;
  }

  async getMyConsents(userId: string) {
    const [consentTypes, currentConsents] = await Promise.all([
      this.consentTypeRepository.findAllActive(),
      this.userConsentRepository.findCurrentByUser(userId)
    ]);

    const grantedByTypeId = new Map(currentConsents.map(c => [c.consentTypeId, c]));
    const data = consentTypes.map(type => MyConsentCatalogDTO(type, grantedByTypeId.get(type.consentTypeId) || null));

    await audit.record('CONSENT_CATALOG_VIEWED', {
      actorId: userId,
      details: { totalItems: data.length, grantedCount: currentConsents.length },
      entityTable: 'consent_types'
    });

    return data;
  }

  async grant(
    items: Array<{ consentTypeCode: string; privacyPolicyId?: string | null }>,
    userId: string,
    auditCtx: Pick<RequestAuditContext, 'ip' | 'userAgent'>
  ) {
    if (!items || items.length === 0) {
      throw AppError.badRequest('Debe proporcionar al menos un consentimiento a otorgar');
    }

    const { granted, auditEntries } = await this.unitOfWork.run(async () => {
      const granted = [];
      const auditEntries = [];

      for (const item of items) {
        const consentType = await this.consentTypeRepository.findByCode(item.consentTypeCode);
        if (!consentType) {
          throw AppError.badRequest(`Tipo de consentimiento "${item.consentTypeCode}" no encontrado o inactivo`);
        }

        const record = await this.userConsentRepository.grant(
          {
            userId,
            consentTypeId: consentType.consentTypeId,
            privacyPolicyId: item.privacyPolicyId || null,
            ip: auditCtx.ip,
            userAgent: auditCtx.userAgent
          }
        );

        auditEntries.push({
          consentTypeCode: item.consentTypeCode,
          consentTypeId: consentType.consentTypeId,
          privacyPolicyId: item.privacyPolicyId || null,
          userConsentId: record.userConsentId
        });

        granted.push(ConsentGrantedDTO(record));
      }
      return { granted, auditEntries };
    });

    for (const entry of auditEntries) {
      await audit.record('CONSENT_GRANTED', {
        actorId: userId,
        details: {
          consentTypeCode: entry.consentTypeCode,
          consentTypeId: entry.consentTypeId,
          privacyPolicyId: entry.privacyPolicyId
        },
        entityType: 'UserConsent',
        entityId: entry.userConsentId,
        entityTable: 'user_consents'
      });
    }

    logger.info('UserConsentService.grant', { userId, count: granted.length });

    return granted;
  }

  async revokeMarketing(
    userId: string,
    consentTypeId: string,
    auditCtx: Pick<RequestAuditContext, 'ip' | 'userAgent'> & { reason?: string | null }
  ) {
    const consentType = await this.consentTypeRepository.findById(consentTypeId);
    if (!consentType) {
      throw AppError.notFound('Tipo de consentimiento no encontrado');
    }
    if (!consentType.isRevocable) {
      throw AppError.badRequest('Este consentimiento no puede ser revocado');
    }

    const revoked = await this.unitOfWork.run(async () => {
      const revoked = await this.userConsentRepository.revoke(
        {
          userId,
          consentTypeId,
          ip: auditCtx.ip,
          reason: auditCtx.reason || null
        }
      );

      if (!revoked) {
        throw AppError.notFound('No se encontró un consentimiento activo para revocar');
      }
      return revoked;
    });

    await audit.record('CONSENT_REVOKED', {
      actorId: userId,
      details: { consentTypeId, reason: auditCtx.reason || null },
      entityType: 'UserConsent',
      entityId: revoked.userConsentId,
      entityTable: 'user_consents'
    });

    logger.info('UserConsentService.revokeMarketing', { userId, consentTypeId });
    return { message: 'Consentimiento revocado exitosamente' };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace UserConsentService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    consentTypeRepository?: typeof consentTypeRepository;
    userConsentRepository?: typeof userConsentRepository;
  }
}

export default Object.assign(new UserConsentService(), { UserConsentService });
