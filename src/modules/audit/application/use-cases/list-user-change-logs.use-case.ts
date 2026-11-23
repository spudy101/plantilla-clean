// Caso de uso: un administrador revisa la bitácora de cambios de cuentas (paginado, con filtros y búsqueda).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { ChangedByRole, ChangeType } from '../../domain/account-change';
import type { ChangeLogRepository } from '../ports/change-log-repository.port';
import { toChangeLogOutput } from '../dto/audit-log.output';

export type ChangeLogListQuery = PageQuery & {
  search?: string | null;
  userId?: string | null;
  changeType?: string | null;
  changedByRole?: string | null;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
};

export class ListUserChangeLogs {
  constructor(
    private readonly changes: ChangeLogRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ChangeLogListQuery }) {
    const page = pageRequest(query);
    const filters = {
      userId: query.userId ?? undefined,
      changeType: (query.changeType ?? undefined) as ChangeType | undefined,
      changedByRole: (query.changedByRole ?? undefined) as ChangedByRole | undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined
    };

    const { rows, count } = await this.changes.list(filters, page, query.search ?? null);

    await this.audit.record('CHANGE_LOG_VIEWED', {
      actorId,
      details: { totalItems: count, page: page.page, ...(query.userId ? { targetUserId: query.userId } : {}) },
      entityId: query.userId ?? null,
      entityType: 'AuditRecord'
    });

    return { data: rows.map(toChangeLogOutput), metadata: pageMetadata(page, count, { search: query.search, ...filters }) };
  }
}
