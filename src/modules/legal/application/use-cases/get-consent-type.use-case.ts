// Caso de uso: un administrador ve el detalle de un tipo de consentimiento.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import { ConsentTypeNotFoundError } from '../../domain/errors';
import { toConsentTypeDetailOutput, type ConsentTypeDetailOutput } from '../dto/consent-type.output';
import { CONSENT_TYPE_AUDIT_ENTITY } from './legal-audit';

export class GetConsentType {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, consentTypeId }: { actorId: string; consentTypeId: string }): Promise<ConsentTypeDetailOutput> {
    const type = await this.consentTypes.findById(consentTypeId);
    if (!type) {
      throw new ConsentTypeNotFoundError();
    }

    await this.audit.record('CONSENT_TYPE_DETAIL_VIEWED', {
      actorId,
      details: { code: type.code },
      ...CONSENT_TYPE_AUDIT_ENTITY,
      entityId: consentTypeId
    });

    return toConsentTypeDetailOutput(type);
  }
}
