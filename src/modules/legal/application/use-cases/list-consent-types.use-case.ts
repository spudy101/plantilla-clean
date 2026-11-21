// Caso de uso: un administrador lista los tipos de consentimiento (paginado, con búsqueda).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageOf, pageRequest } from '../../../../shared/application/pagination';
import type { ConsentTypeRepository } from '../ports/consent-type-repository.port';
import { toConsentTypeListItemOutput } from '../dto/consent-type.output';
import { CONSENT_TYPE_AUDIT_ENTITY, type ListQuery } from './legal-audit';

export class ListConsentTypes {
  constructor(
    private readonly consentTypes: ConsentTypeRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ListQuery }) {
    const page = pageRequest(query);
    const { rows, count } = await this.consentTypes.list(page, query.search ?? null);

    await this.audit.record('CONSENT_TYPE_LIST_VIEWED', {
      actorId,
      details: { totalItems: count, page: page.page },
      ...CONSENT_TYPE_AUDIT_ENTITY
    });

    return pageOf(rows.map(toConsentTypeListItemOutput), page, count, { search: query.search });
  }
}
