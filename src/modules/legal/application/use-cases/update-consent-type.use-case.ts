// Caso de uso: un administrador edita un tipo de consentimiento (nombre, descripción, estado).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import type { ConsentTypePatch } from '../../domain/consent-type';
import { ConsentTypeNotFoundError } from '../../domain/errors';
import { toConsentTypeDetailOutput, type ConsentTypeDetailOutput } from '../dto/consent-type.output';
import { CONSENT_TYPE_AUDIT_ENTITY } from './legal-audit';
import { noticeConsentTypeAdmin, type ConsentTypeNoticeDeps } from './consent-type-admin-notice';

export interface UpdateConsentTypeInput {
  actorId: string;
  consentTypeId: string;
  patch: ConsentTypePatch;
}

export class UpdateConsentType {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly audit: AuditTrail,
    private readonly notice: ConsentTypeNoticeDeps
  ) {}

  async execute({ actorId, consentTypeId, patch }: UpdateConsentTypeInput): Promise<ConsentTypeDetailOutput> {
    const current = await this.consentTypes.findById(consentTypeId);
    if (!current) {
      throw new ConsentTypeNotFoundError();
    }

    const updated = await this.consentTypes.update(consentTypeId, current.changesFor(patch));
    if (!updated) {
      throw new ConsentTypeNotFoundError();
    }

    await this.audit.record('CONSENT_TYPE_UPDATED', {
      actorId,
      details: { consentTypeId, changes: patch },
      ...CONSENT_TYPE_AUDIT_ENTITY,
      entityId: consentTypeId
    });

    noticeConsentTypeAdmin(this.notice, 'actualizado', updated, actorId);
    return toConsentTypeDetailOutput(updated);
  }
}
