// Caso de uso: las alertas de auditoría del Superadmin (paginado), con cuántas siguen pendientes.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { AuditAlertRepository } from '../ports/audit-alert-repository.port';
import { toAuditAlertOutput } from '../dto/audit-log.output';
import { AUDIT_ALERT_ENTITY } from './audit-entities';

export type AuditAlertListQuery = PageQuery & {
  acknowledged?: boolean | null;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
  action?: string | null;
  category?: string | null;
};

export class ListAuditAlerts {
  constructor(
    private readonly alerts: AuditAlertRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: AuditAlertListQuery }) {
    const page = pageRequest(query);
    const filters = {
      acknowledged: query.acknowledged ?? undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined,
      action: query.action ?? undefined,
      category: query.category ?? undefined
    };
    const { rows, count } = await this.alerts.list(filters, page);
    const pending = await this.alerts.countPending();

    await this.audit.record('AUDIT_ALERT_LISTED', { actorId, details: { totalItems: count, pending }, ...AUDIT_ALERT_ENTITY });

    return { data: rows.map(toAuditAlertOutput), metadata: { ...pageMetadata(page, count, filters), pendingCount: pending } };
  }
}
