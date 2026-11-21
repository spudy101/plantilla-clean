// Caso de uso: el usuario retira un consentimiento (solo los tipos revocables, p. ej. marketing).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { UserConsentRepository } from '../ports/user-consent-repository.port';
import { ConsentTypeNotFoundError, NoActiveConsentToRevokeError } from '../../domain/errors';
import { USER_CONSENT_AUDIT_ENTITY } from './legal-audit';

export interface RevokeConsentInput {
  userId: string;
  consentTypeId: string;
  ip: string | null;
  reason?: string | null;
}

export class RevokeConsent {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly consentTypes: ConsentTypeRepository,
    private readonly userConsents: UserConsentRepository,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ userId, consentTypeId, ip, reason }: RevokeConsentInput): Promise<{ message: string }> {
    const type = await this.consentTypes.findById(consentTypeId);
    if (!type) {
      throw new ConsentTypeNotFoundError();
    }
    type.assertRevocable();

    const revoked = await this.unitOfWork.run(async () => {
      const consent = await this.userConsents.revokeCurrent({ userId, consentTypeId, ip, reason: reason || null });
      if (!consent) {
        throw new NoActiveConsentToRevokeError();
      }
      return consent;
    });

    await this.audit.record('CONSENT_REVOKED', {
      actorId: userId,
      details: { consentTypeId, reason: reason || null },
      entityType: USER_CONSENT_AUDIT_ENTITY.entityType,
      entityId: revoked.userConsentId,
      entityTable: USER_CONSENT_AUDIT_ENTITY.entityTable
    });

    this.logger.info('RevokeConsent', { userId, consentTypeId });
    return { message: 'Consentimiento revocado exitosamente' };
  }
}
