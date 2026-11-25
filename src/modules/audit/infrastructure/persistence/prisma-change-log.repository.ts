// Adaptador Prisma del puerto ChangeLogRepository. La bitácora no es una tabla propia: es una vista sobre
// audit_logs (acción USER_FIELD_CHANGED) con los datos del cambio en `details` (JSON).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { loadUserRefs } from '../../../../shared/infrastructure/database/user-ref';
import type { ChangeLogFilters, ChangeLogRepository } from '../../application/ports/change-log-repository.port';
import type { Page } from '../../application/ports/audit-log-repository.port';
import { ACCOUNT_CHANGE_ACTION, type ChangedByRole, type ChangeLogWithUsers } from '../../domain/account-change';
import type { ExternalChange } from '../../domain/activity-feed';
import { AuditMapper } from './audit.mapper';

type DetailField = 'changeType' | 'changedByRole' | 'previousValue' | 'newValue' | 'changeReason';

/** Filtro sobre un campo de details (JSON). */
const detail = (field: DetailField, value: string): Prisma.AuditLogWhereInput => ({ details: { path: [field], equals: value } });

export function changeLogWhere(filters: ChangeLogFilters, search: string | null = null): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (filters.changeType) {
    and.push(detail('changeType', filters.changeType));
  }
  if (filters.changedByRole) {
    and.push(detail('changedByRole', filters.changedByRole));
  }
  if (filters.changedByRoles) {
    and.push({ OR: filters.changedByRoles.map(r => detail('changedByRole', r)) });
  }
  if (search) {
    and.push({ OR: (['changeReason', 'previousValue', 'newValue'] as const).map(f => ({ details: { path: [f], string_contains: search } })) });
  }
  return {
    action: ACCOUNT_CHANGE_ACTION,
    ...(filters.userId ? { entityId: filters.userId } : {}),
    ...(filters.changedByUserId ? { userId: filters.changedByUserId } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          createdAt: {
            ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {})
          }
        }
      : {}),
    ...(and.length > 0 ? { AND: and } : {})
  };
}

export class PrismaChangeLogRepository extends PrismaRepository implements ChangeLogRepository {
  async list(filters: ChangeLogFilters, page: PageRequest, search: string | null): Promise<Page<ChangeLogWithUsers>> {
    const where = changeLogWhere(filters, search);
    const db = await this.db();
    const [logs, count] = await Promise.all([
      db.auditLog.findMany({ where, ...this.paginationArgs(page, 'auditLogId') }),
      db.auditLog.count({ where })
    ]);
    const rows = logs.map(AuditMapper.changeLogToDomain);
    const users = await loadUserRefs(db, rows.flatMap(r => [r.userId, r.changedByUserId]));
    return {
      rows: rows.map(r => ({
        ...r,
        user: AuditMapper.userRef(users.get(r.userId)),
        changedBy: r.changedByUserId ? AuditMapper.userRef(users.get(r.changedByUserId)) : null
      })),
      count
    };
  }

  async findChangesBy(
    userId: string,
    roles: readonly ChangedByRole[],
    { limit, offset }: { limit: number; offset: number }
  ): Promise<Page<ExternalChange>> {
    const where = changeLogWhere({ userId, changedByRoles: roles });
    const db = await this.db();
    const [logs, count] = await Promise.all([
      db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      db.auditLog.count({ where })
    ]);
    const rows = logs.map(AuditMapper.changeLogToDomain).map(r => ({
      logId: r.logId,
      changeType: r.changeType,
      changedByRole: r.changedByRole,
      originSessionId: r.originSessionId,
      createdAt: r.createdAt
    }));
    return { rows, count };
  }

}
