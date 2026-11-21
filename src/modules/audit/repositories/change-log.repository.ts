// modules/audit/repositories/change-log.repository.ts
//
// Bitácora de cambios sobre una cuenta (email, contraseña, MFA, estado, rol…). No es una tabla propia: es
// una vista sobre audit_logs (acción USER_FIELD_CHANGED; ver audit.recordChange). Devuelve filas con la
// forma de siempre (logId, changeType, previousValue/newValue…) para que los DTOs no cambien.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import type { AuditLog, Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import { loadUserRefs, type UserRef } from './user-ref';
import type { ChangedByRole, ChangeType } from '../audit.service';

const CHANGE_ACTION = 'USER_FIELD_CHANGED';

interface ChangeDetails {
  changeType?: ChangeType;
  changedByRole?: ChangedByRole;
  previousValue?: string | null;
  newValue?: string | null;
  changeReason?: string | null;
}

export interface ChangeLogRow {
  logId: string;
  userId: string;
  changedByUserId: string | null;
  changedByRole: ChangedByRole;
  changeType: ChangeType;
  previousValue: string | null;
  newValue: string | null;
  changeReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  originSessionId: string | null;
  createdAt: Date;
}
export type ChangeLogWithUsers = ChangeLogRow & { user: UserRef | null; changedBy: UserRef | null };

const detailsOf = (log: AuditLog) => (log.details ?? {}) as ChangeDetails;

function toRow(log: AuditLog): ChangeLogRow {
  const d = detailsOf(log);
  return {
    logId: log.auditLogId,
    userId: log.entityId ?? '',
    changedByUserId: log.userId,
    changedByRole: d.changedByRole ?? 'system',
    changeType: d.changeType as ChangeType,
    previousValue: d.previousValue ?? null,
    newValue: d.newValue ?? null,
    changeReason: d.changeReason ?? null,
    ipAddress: log.ip,
    userAgent: log.userAgent,
    originSessionId: log.sessionId,
    createdAt: log.createdAt
  };
}

/** Filtro sobre un campo de details (JSON). */
const detail = (field: keyof ChangeDetails, value: string): Prisma.AuditLogWhereInput => ({ details: { path: [field], equals: value } });

class ChangeLogRepository extends PrismaRepository {
  private where(filters: ChangeLogRepository.Filters, searchTerm: string | null = null): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];
    if (filters.changeType) and.push(detail('changeType', filters.changeType));
    if (filters.changedByRole) and.push(detail('changedByRole', filters.changedByRole));
    if (filters.changedByRoles) and.push({ OR: filters.changedByRoles.map(r => detail('changedByRole', r)) });
    if (searchTerm) {
      and.push({
        OR: (['changeReason', 'previousValue', 'newValue'] as const).map(f => ({
          details: { path: [f], string_contains: searchTerm }
        }))
      });
    }
    return {
      action: CHANGE_ACTION,
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

  /**
   * Cambios hechos SOBRE el usuario por un tercero (admin/system), para el feed de actividad del cliente.
   * Los que hizo el propio usuario ya están en su rastro. Sin valores: el feed nunca los expone.
   */
  async findExternalChangesByUserId(userId: string, { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}) {
    const where = this.where({ userId, changedByRoles: ['admin', 'system'] });
    const db = await this.db();
    const [logs, count] = await Promise.all([
      db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      db.auditLog.count({ where })
    ]);
    const rows = logs.map(toRow).map(r => ({
      logId: r.logId,
      changeType: r.changeType,
      changedByRole: r.changedByRole,
      originSessionId: r.originSessionId,
      createdAt: r.createdAt
    }));
    return { rows, count };
  }

  /** Listado paginado con el usuario afectado y quién hizo el cambio. */
  async findAllPaginated(
    filters: ChangeLogRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<ChangeLogWithUsers>> {
    const where = this.where(filters, searchTerm);
    const db = await this.db();
    const [logs, count] = await Promise.all([
      db.auditLog.findMany({ where, ...this.paginationArgs(pagination, 'auditLogId') }),
      db.auditLog.count({ where })
    ]);
    const rows = logs.map(toRow);
    const users = await loadUserRefs(db, rows.flatMap(r => [r.userId, r.changedByUserId]));
    return {
      rows: rows.map(r => ({ ...r, user: users.get(r.userId) ?? null, changedBy: r.changedByUserId ? (users.get(r.changedByUserId) ?? null) : null })),
      count
    };
  }

  /** Cambios de un usuario. */
  findByUserId(userId: string, pagination: PageRequest) {
    return this.findAllPaginated({ userId }, pagination);
  }

  /** Cambios hechos por un admin. */
  findByAdminUser(adminUserId: string, pagination: PageRequest) {
    return this.findAllPaginated({ changedByUserId: adminUserId, changedByRole: 'admin' }, pagination);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ChangeLogRepository {
  export type Filters = {
    changeType?: ChangeType;
    changedByRole?: ChangedByRole;
    changedByRoles?: ChangedByRole[];
    changedByUserId?: string;
    userId?: string;
    dateFrom?: string | Date;
    dateTo?: string | Date;
  };
}

export default Object.assign(new ChangeLogRepository(), { ChangeLogRepository });
