// Caso de uso: historial paginado de las ventanas de fallback (cuándo estuvo caído cada proveedor, cuánto
// duró y a cuántos procesos afectó).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageOf, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { FallbackEventRepository, FallbackHistoryFilters } from '../ports/fallback-event-repository.port';
import { toFallbackEventOutput } from '../dto/integration-monitoring.output';
import { FALLBACK_AUDIT_ENTITY } from './integration-audit';

export type FallbackHistoryQuery = PageQuery & {
  provider?: string | null;
  activeOnly?: boolean | null;
  from?: Date | null;
  to?: Date | null;
};

export class ListFallbackHistory {
  constructor(
    private readonly fallbacks: FallbackEventRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: FallbackHistoryQuery }) {
    const page = pageRequest(query);
    const filters: FallbackHistoryFilters = {
      provider: query.provider || null,
      activeOnly: query.activeOnly === true,
      from: query.from ?? null,
      to: query.to ?? null
    };

    const { rows, count } = await this.fallbacks.list(filters, page);

    await this.audit.record('PROVIDER_FALLBACK_HISTORY_VIEWED', {
      actorId,
      details: { totalItems: count },
      ...FALLBACK_AUDIT_ENTITY
    });

    // activeOnly en false no es un filtro aplicado: no se informa en la metadata
    return pageOf(rows.map(toFallbackEventOutput), page, count, { ...filters, activeOnly: filters.activeOnly || undefined });
  }
}
