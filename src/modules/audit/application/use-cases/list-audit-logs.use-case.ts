// Caso de uso: un administrador busca en la auditoría (paginado, con filtros).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { appliedFilters, pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { AuditLogFilters, AuditLogRepository } from '../ports/audit-log-repository.port';
import { toAuditLogListItemOutput } from '../dto/audit-log.output';
import { AUDIT_LOG_ENTITY } from './audit-entities';

/** Filtros tal como llegan: null o ausente = sin ese filtro. */
export type AuditLogQueryFilters = { [K in keyof AuditLogFilters]?: AuditLogFilters[K] | null };

/** Solo los filtros con valor (el repositorio los recibe como opcionales). */
export const definedFilters = (filters: AuditLogQueryFilters): AuditLogFilters =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== null && v !== undefined)) as AuditLogFilters;

export class ListAuditLogs {
  constructor(
    private readonly logs: AuditLogRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: PageQuery & AuditLogQueryFilters }) {
    const { page: pageNumber, limit, sortBy, order, ...filters } = query;
    const page = pageRequest({ page: pageNumber, limit, sortBy, order });
    const { rows, count } = await this.logs.search(definedFilters(filters), page);
    const activeFilters = appliedFilters(filters);

    await this.audit.record('AUDIT_LOG_LISTED', {
      actorId,
      details: { totalItems: count, filters: Object.keys(activeFilters) },
      ...AUDIT_LOG_ENTITY
    });

    return { data: rows.map(toAuditLogListItemOutput), metadata: pageMetadata(page, count, activeFilters) };
  }
}
