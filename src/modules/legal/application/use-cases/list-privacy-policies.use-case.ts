// Caso de uso: un administrador lista las versiones de la política de privacidad (paginado, con búsqueda y
// filtro por estado).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageMetadata, pageRequest } from '../../../../shared/application/pagination';
import type { PrivacyPolicyRepository } from '../ports/privacy-policy-repository.port';
import { toPrivacyPolicyItemOutput } from '../dto/privacy-policy.output';
import { PRIVACY_POLICY_AUDIT_ENTITY, type ListQuery } from './legal-audit';

export class ListPrivacyPolicies {
  constructor(
    private readonly policies: PrivacyPolicyRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ListQuery & { isActive?: boolean | null } }) {
    const page = pageRequest(query);
    const filters = { isActive: query.isActive ?? undefined };
    const { rows, count } = await this.policies.list(filters, page, query.search ?? null);

    await this.audit.record('PRIVACY_POLICY_LIST_VIEWED', {
      actorId,
      details: { totalItems: count, page: page.page },
      ...PRIVACY_POLICY_AUDIT_ENTITY
    });

    return {
      data: rows.map(toPrivacyPolicyItemOutput),
      metadata: pageMetadata(page, count, { search: query.search, ...filters })
    };
  }
}
