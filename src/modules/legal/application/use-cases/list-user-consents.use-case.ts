// Caso de uso: un administrador revisa los consentimientos otorgados (paginado, con filtros).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { appliedFilters, pageOf, pageRequest } from '../../../../shared/application/pagination';
import type { UserConsentAdminFilters, UserConsentRepository } from '../ports/user-consent-repository.port';
import { toUserConsentOutput } from '../dto/user-consent.output';
import { USER_CONSENT_AUDIT_ENTITY, type ListQuery } from './legal-audit';

export type ListUserConsentsQuery = Omit<ListQuery, 'search'> & {
  userId?: string | null;
  consentTypeCode?: string | null;
  isCurrent?: boolean | null;
  dateFrom?: string | Date | null;
  dateTo?: string | Date | null;
};

export class ListUserConsents {
  constructor(
    private readonly userConsents: UserConsentRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ListUserConsentsQuery }) {
    const page = pageRequest(query);
    // Solo los filtros que llegaron (sin undefined): así se ven en la auditoría y en la metadata
    const filters = appliedFilters({
      userId: query.userId,
      consentTypeCode: query.consentTypeCode,
      isCurrent: query.isCurrent,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    }) as UserConsentAdminFilters;

    const { rows, count } = await this.userConsents.listForAdmin(filters, page);

    await this.audit.record('CONSENT_LIST_VIEWED', {
      actorId,
      details: { totalItems: count, filters: Object.keys(filters) },
      ...USER_CONSENT_AUDIT_ENTITY
    });

    return pageOf(rows.map(toUserConsentOutput), page, count, filters);
  }
}
