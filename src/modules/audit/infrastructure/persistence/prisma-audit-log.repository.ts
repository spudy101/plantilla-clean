// Adaptador Prisma del puerto AuditLogRepository.
//
// `audit_logs` es append-only: la garantía dura es el trigger de la base (BEFORE UPDATE OR DELETE); este
// repositorio no expone update ni delete, salvo la purga de retención que el trigger autoriza.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type {
  AuditLog,
  AuditLogOutcome,
  AuditLogRisk,
  Prisma
} from '../../../../shared/infrastructure/database/generated/prisma/client';
import { loadUserRefs } from '../../../../shared/infrastructure/database/user-ref';
import type { AuditLogFilters, AuditLogRepository, AuthAttemptCriteria, Page } from '../../application/ports/audit-log-repository.port';
import type { AuditLogEntry, AuditLogWithExecutor, NewAuditLog } from '../../domain/audit-log';
import type { OwnActivity } from '../../domain/activity-feed';
import type { EntityRef } from '../../domain/session-trace';
import { AuditMapper } from './audit.mapper';

const SEARCHABLE_FIELDS = [
  'action',
  'userId',
  'sessionId',
  'category',
  'module',
  'outcome',
  'risk',
  'ip',
  'correlationId',
  'entityId',
  'entityType',
  'source'
] as const;

function createdAtRange(from?: string | Date, to?: string | Date): Prisma.AuditLogWhereInput {
  if (from == null && to == null) {
    return {};
  }
  return { createdAt: { ...(from != null ? { gte: from } : {}), ...(to != null ? { lte: to } : {}) } };
}

/** Los filtros del listado y la exportación como WHERE (lo desconocido se ignora). */
export function auditLogWhere(filters: AuditLogFilters = {}): Prisma.AuditLogWhereInput {
  const where: Record<string, unknown> = { ...createdAtRange(filters.dateFrom, filters.dateTo) };
  for (const field of SEARCHABLE_FIELDS) {
    if (filters[field]) {
      where[field] = filters[field];
    }
  }
  return where as Prisma.AuditLogWhereInput;
}

/** WHERE de intentos de autenticación: por acciones (o, sin ellas, por categoría), usuario y resultado. */
export function authAttemptsWhere({ from, to, actions, category, userId, outcome }: AuthAttemptCriteria): Prisma.AuditLogWhereInput {
  return {
    createdAt: { gte: from, lte: to },
    ...(actions && actions.length ? { action: { in: actions } } : category ? { category } : {}),
    ...(userId ? { userId } : {}),
    ...(outcome ? { outcome: outcome as AuditLogOutcome } : {})
  };
}

export class PrismaAuditLogRepository extends PrismaRepository implements AuditLogRepository {
  async append(log: NewAuditLog, { independent }: { independent: boolean }): Promise<AuditLogEntry> {
    const db = independent ? this.independentDb() : await this.db();
    const row = await db.auditLog.create({
      data: {
        action: log.action,
        description: log.description,
        category: log.category,
        risk: log.risk as AuditLogRisk,
        module: log.module,
        outcome: log.outcome,
        userId: log.userId,
        sessionId: log.sessionId,
        correlationId: log.correlationId,
        ip: log.ip,
        userAgent: log.userAgent,
        fingerprint: log.fingerprint,
        source: log.source,
        details: log.details as Prisma.InputJsonValue,
        entityId: log.entityId,
        entityType: log.entityType,
        entityTable: log.entityTable
      }
    });
    return AuditMapper.auditLogToDomain(row);
  }

  search(filters: AuditLogFilters, page: PageRequest): Promise<Page<AuditLogWithExecutor>> {
    return this.pageWithExecutor(auditLogWhere(filters), page);
  }

  async findById(auditLogId: string): Promise<AuditLogWithExecutor | null> {
    const row = await (await this.db()).auditLog.findUnique({ where: { auditLogId } });
    return row ? (await this.withExecutor([row]))[0]! : null;
  }

  async findForExport(filters: AuditLogFilters, limit: number): Promise<AuditLogEntry[]> {
    const rows = await (await this.db()).auditLog.findMany({ where: auditLogWhere(filters), orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(AuditMapper.auditLogToDomain);
  }

  async findByCorrelationId(correlationId: string): Promise<AuditLogEntry[]> {
    const rows = await (await this.db()).auditLog.findMany({ where: { correlationId }, orderBy: { createdAt: 'asc' } });
    return rows.map(AuditMapper.auditLogToDomain);
  }

  findBySession(sessionId: string, page: PageRequest): Promise<Page<AuditLogWithExecutor>> {
    return this.pageWithExecutor({ sessionId }, page);
  }

  async countBySessions(sessionIds: string[]): Promise<Map<string, number>> {
    if (sessionIds.length === 0) {
      return new Map();
    }
    const groups = await (await this.db()).auditLog.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessionIds } },
      _count: { _all: true }
    });
    return new Map(groups.map(g => [g.sessionId as string, g._count._all]));
  }

  async findEntityRefsBySession(sessionId: string): Promise<EntityRef[]> {
    const rows = await (await this.db()).auditLog.findMany({
      where: { sessionId, entityTable: { not: null }, entityId: { not: null } },
      select: { entityTable: true, entityId: true }
    });
    return rows as EntityRef[];
  }

  async findOwnActivity(userId: string, actions: readonly string[], { limit, offset }: { limit: number; offset: number }): Promise<Page<OwnActivity>> {
    const where = { userId, action: { in: [...actions] } } satisfies Prisma.AuditLogWhereInput;
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: { auditLogId: true, action: true, description: true, category: true, outcome: true, ip: true, sessionId: true, createdAt: true }
      }),
      db.auditLog.count({ where })
    ]);
    return { rows, count };
  }

  // ── Retención ──

  async findCreatedBetween(from: Date, to: Date): Promise<AuditLogEntry[]> {
    const rows = await (await this.db()).auditLog.findMany({ where: { createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' } });
    return rows.map(AuditMapper.auditLogToDomain);
  }

  async countCreatedUpTo(cutoff: Date): Promise<number> {
    return (await this.db()).auditLog.count({ where: { createdAt: { lte: cutoff } } });
  }

  async countCreatedBefore(cutoff: Date): Promise<number> {
    return (await this.db()).auditLog.count({ where: { createdAt: { lt: cutoff } } });
  }

  /** El trigger solo la autoriza con `app.allow_audit_purge` puesto en la MISMA transacción (SET LOCAL). */
  purgeCreatedBefore(cutoff: Date): Promise<number> {
    return this.ownTransaction(async db => {
      await db.$executeRaw`SET LOCAL app.allow_audit_purge = 'true'`;
      return (await db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
    });
  }

  /** Intentos de autenticación (la vista de sesiones de iam). */
  findAuthAttempts(criteria: AuthAttemptCriteria, page: PageRequest): Promise<Page<AuditLogWithExecutor>> {
    return this.pageWithExecutor(authAttemptsWhere(criteria), page);
  }

  private async pageWithExecutor(where: Prisma.AuditLogWhereInput, page: PageRequest): Promise<Page<AuditLogWithExecutor>> {
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.auditLog.findMany({ where, ...this.paginationArgs(page, 'auditLogId') }),
      db.auditLog.count({ where })
    ]);
    return { rows: await this.withExecutor(rows), count };
  }

  private async withExecutor(rows: AuditLog[]): Promise<AuditLogWithExecutor[]> {
    const users = await loadUserRefs(await this.db(), rows.map(r => r.userId));
    return rows.map(r => ({ ...AuditMapper.auditLogToDomain(r), executor: AuditMapper.userRef(r.userId ? users.get(r.userId) : null) }));
  }
}
