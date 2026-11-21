// Caso de uso: un administrador ve el detalle de una versión (incluye la URL pública del PDF).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { PrivacyPolicyRepository } from '../ports/privacy-policy-repository.port';
import { PrivacyPolicyNotFoundError } from '../../domain/errors';
import { toPrivacyPolicyDetailOutput, type PrivacyPolicyDetailOutput } from '../dto/privacy-policy.output';
import { PRIVACY_POLICY_AUDIT_ENTITY } from './legal-audit';

export class GetPrivacyPolicy {
  constructor(
    private readonly policies: PrivacyPolicyRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, privacyPolicyId }: { actorId: string; privacyPolicyId: string }): Promise<PrivacyPolicyDetailOutput> {
    const policy = await this.policies.findById(privacyPolicyId);
    if (!policy) {
      throw new PrivacyPolicyNotFoundError();
    }

    await this.audit.record('PRIVACY_POLICY_DETAIL_VIEWED', {
      actorId,
      details: { version: policy.version },
      entityId: privacyPolicyId,
      ...PRIVACY_POLICY_AUDIT_ENTITY
    });

    return toPrivacyPolicyDetailOutput(policy);
  }
}
