// Caso de uso: el usuario otorga uno o varios consentimientos en un solo envío.
//
// Todo o nada: se otorgan dentro de una unidad de trabajo, y si un tipo no existe no queda ninguno. La
// auditoría se registra después de confirmar (no se audita lo que se revirtió).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { NoConsentsToGrantError, UnknownConsentTypeError } from '../../domain/errors';
import { toGrantedConsentOutput, type GrantedConsentOutput } from '../dto/user-consent.output';
import { USER_CONSENT_AUDIT_ENTITY } from './legal-audit';

export interface GrantConsentsInput {
  userId: string;
  items: Array<{ consentTypeCode: string; privacyPolicyId?: string | null }>;
  ip: string | null;
  userAgent: string | null;
}

export class GrantConsents {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly consentTypes: ConsentTypeRepository,
    private readonly userConsents: UserConsentRepository,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ userId, items, ip, userAgent }: GrantConsentsInput): Promise<GrantedConsentOutput[]> {
    if (!items || items.length === 0) {
      throw new NoConsentsToGrantError();
    }

    const granted = await this.unitOfWork.run(async () => {
      const done = [];
      for (const item of items) {
        const type = await this.consentTypes.findActiveByCode(item.consentTypeCode);
        if (!type) {
          throw new UnknownConsentTypeError(item.consentTypeCode);
        }
        const privacyPolicyId = item.privacyPolicyId || null;
        const consent = await this.userConsents.grant({ userId, consentTypeId: type.consentTypeId, privacyPolicyId, ip, userAgent });
        done.push({ item, type, privacyPolicyId, consent });
      }
      return done;
    });

    for (const { item, type, privacyPolicyId, consent } of granted) {
      await this.audit.record('CONSENT_GRANTED', {
        actorId: userId,
        details: { consentTypeCode: item.consentTypeCode, consentTypeId: type.consentTypeId, privacyPolicyId },
        entityType: USER_CONSENT_AUDIT_ENTITY.entityType,
        entityId: consent.userConsentId,
        entityTable: USER_CONSENT_AUDIT_ENTITY.entityTable
      });
    }

    this.logger.info('GrantConsents', { userId, count: granted.length });
    return granted.map(g => toGrantedConsentOutput(g.consent));
  }
}
