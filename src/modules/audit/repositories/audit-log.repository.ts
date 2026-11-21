// modules/schemas/records/audit/repositories/audit-log.repository.ts
//
// `audit_logs` es append-only: la garantía dura es el trigger de BD (BEFORE UPDATE OR DELETE); este
// repositorio no expone update ni delete. Las escrituras van con el cliente por defecto aunque haya una
// unidad de trabajo activa: la auditoría queda aunque el flujo que la disparó se revierta.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { AuditLog, AuditLogOutcome } from '../../../shared/infrastructure/database/generated/prisma/client';
import { loadUserRefs } from './user-ref';
import type { UserRef } from './user-ref';

/** Log con quién ejecutó la acción (usuario + nombre). */
export type AuditLogWithExecutor = AuditLog & { executor: UserRef | null };

class AuditLogRepository extends PrismaRepository {
  /**
   * Registra una entrada. Por defecto dentro de la transacción en curso (el hecho y su auditoría se
   * guardan juntos o ninguno); `independent` la escribe aparte (intentos fallidos: la transacción se va
   * a revertir y el intento debe quedar).
   */
  async create(data: Prisma.AuditLogUncheckedCreateInput, { independent = false } = {}): Promise<AuditLog> {
    const db = independent ? this.independentDb() : await this.db();
    return db.auditLog.create({ data });
  }

  /**
   * Feed de actividad del PROPIO usuario (endpoint client): solo acciones de una whitelist client-safe.
   * El DTO nunca expone `details` (claves before/after) ni campos técnicos.
   */
  async findClientSafeByUser(userId: string, actions: string[], { limit = 50, offset = 0 }: AuditLogRepository.Page = {}) {
    const where = { userId, action: { in: actions } } satisfies Prisma.AuditLogWhereInput;
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

  /** Paginación con el executor adjunto. */
  async findPaginatedWithExecutor(where: Prisma.AuditLogWhereInput, page: PageRequest): Promise<PrismaRepository.Page<AuditLogWithExecutor>> {
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.auditLog.findMany({ where, ...this.paginationArgs(page, 'auditLogId') }),
      db.auditLog.count({ where })
    ]);
    return { rows: await this.attachExecutor(rows), count };
  }

  /** Hechos de negocio de una operación, en orden cronológico. */
  async findByCorrelationId(correlationId: string): Promise<AuditLog[]> {
    return (await this.db()).auditLog.findMany({ where: { correlationId }, orderBy: { createdAt: 'asc' } });
  }

  /** Detalle de un log, con el executor. */
  async findByIdFull(auditLogId: string): Promise<AuditLogWithExecutor | null> {
    const row = await (await this.db()).auditLog.findUnique({ where: { auditLogId } });
    return row ? (await this.attachExecutor([row]))[0]! : null;
  }

  /** Traduce los filtros del listado/exportación de auditoría a un WHERE. */
  buildSearchWhere(filters: AuditLogRepository.SearchFilters = {}): Prisma.AuditLogWhereInput {
    const where: Record<string, unknown> = { ...createdAtRange(filters.dateFrom, filters.dateTo) };
    const fields = ['action', 'userId', 'sessionId', 'category', 'module', 'outcome', 'risk', 'ip', 'correlationId', 'entityId', 'entityType', 'source'] as const;
    for (const field of fields) {
      if (filters[field]) {
        where[field] = filters[field];
      }
    }
    return where as Prisma.AuditLogWhereInput;
  }

  /** Listado paginado de auditoría a partir de filtros de negocio. */
  searchPaginated(filters: AuditLogRepository.SearchFilters, pagination: PageRequest) {
    return this.findPaginatedWithExecutor(this.buildSearchWhere(filters), pagination);
  }

  /** Exportación (sin executor) a partir de filtros de negocio. */
  async searchForExport(filters: AuditLogRepository.SearchFilters, limit: number): Promise<AuditLog[]> {
    return (await this.db()).auditLog.findMany({ where: this.buildSearchWhere(filters), orderBy: { createdAt: 'desc' }, take: limit });
  }

  /** WHERE de intentos de autenticación: por acciones (o, sin ellas, por categoría), usuario y resultado. */
  buildAuthAttemptsWhere({ from, to, actions, category, userId, outcome }: AuditLogRepository.AuthAttemptsCriteria): Prisma.AuditLogWhereInput {
    return {
      createdAt: { gte: from, lte: to },
      ...(actions && actions.length ? { action: { in: actions } } : category ? { category } : {}),
      ...(userId ? { userId } : {}),
      ...(outcome ? { outcome: outcome as AuditLogOutcome } : {})
    };
  }

  /** Intentos de autenticación paginados. */
  findAuthAttemptsPaginated(criteria: AuditLogRepository.AuthAttemptsCriteria, pagination: PageRequest) {
    return this.findPaginatedWithExecutor(this.buildAuthAttemptsWhere(criteria), pagination);
  }

  // ── Traza por sesión ──────────────────────────────────────────────────────────

  /** Conteo de eventos por sesión, para un conjunto de sesiones (un solo query agrupado). */
  async countBySessionIds(sessionIds: string[]): Promise<Array<{ sessionId: string; count: number }>> {
    if (!sessionIds || sessionIds.length === 0) {
      return [];
    }
    const groups = await (await this.db()).auditLog.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessionIds } },
      _count: { _all: true }
    });
    return groups.map(g => ({ sessionId: g.sessionId as string, count: g._count._all }));
  }

  /**
   * Referencias de dominio (tabla + id) tocadas en una sesión: fuente de la hidratación por lote. Se
   * descartan los eventos sin entidad puntual.
   */
  async findEntityRefsBySession(sessionId: string): Promise<Array<{ entityTable: string; entityId: string; entityType: string | null }>> {
    const rows = await (await this.db()).auditLog.findMany({
      where: { sessionId, entityTable: { not: null }, entityId: { not: null } },
      select: { entityTable: true, entityId: true, entityType: true }
    });
    return rows as Array<{ entityTable: string; entityId: string; entityType: string | null }>;
  }

  // ── Retención (worker de archivado, RF-ADM-03) ──────────────────────────────

  /** Registros creados en [from, to), en orden: la exportación diaria a S3. */
  async findCreatedBetween(from: Date, to: Date): Promise<AuditLog[]> {
    return (await this.db()).auditLog.findMany({ where: { createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' } });
  }

  /** Cuántos registros se crearon hasta `cutoff` inclusive (aviso de próximos a vencer). */
  async countCreatedUpTo(cutoff: Date): Promise<number> {
    return (await this.db()).auditLog.count({ where: { createdAt: { lte: cutoff } } });
  }

  /** Cuántos registros se crearon antes de `cutoff` (candidatos a purga). */
  async countCreatedBefore(cutoff: Date): Promise<number> {
    return (await this.db()).auditLog.count({ where: { createdAt: { lt: cutoff } } });
  }

  /**
   * Purga de retención: borra los registros creados antes de `cutoff` (la copia vive en S3). Es la ÚNICA
   * baja permitida en esta tabla append-only: el trigger la autoriza solo con `app.allow_audit_purge`
   * puesto en la misma transacción (SET LOCAL).
   */
  purgeCreatedBefore(cutoff: Date): Promise<number> {
    return this.ownTransaction(async db => {
      await db.$executeRaw`SET LOCAL app.allow_audit_purge = 'true'`;
      return (await db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
    });
  }

  private async attachExecutor(rows: AuditLog[]): Promise<AuditLogWithExecutor[]> {
    const users = await loadUserRefs(await this.db(), rows.map(r => r.userId));
    return rows.map(r => ({ ...r, executor: (r.userId && users.get(r.userId)) || null }));
  }
}

function createdAtRange(from?: string | Date, to?: string | Date): Prisma.AuditLogWhereInput {
  if (from == null && to == null) {
    return {};
  }
  return { createdAt: { ...(from != null ? { gte: from } : {}), ...(to != null ? { lte: to } : {}) } };
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AuditLogRepository {
  export interface Page {
    limit?: number;
    offset?: number;
  }


  /** Filtros de negocio del listado/exportación de auditoría (los traduce buildSearchWhere). */
  export interface SearchFilters {
    dateFrom?: string | Date;
    dateTo?: string | Date;
    action?: string;
    userId?: string;
    sessionId?: string;
    category?: string;
    module?: string;
    outcome?: string;
    risk?: string;
    ip?: string;
    correlationId?: string;
    entityId?: string;
    entityType?: string;
    source?: string;
  }

  export interface AuthAttemptsCriteria {
    from: Date;
    to: Date;
    actions?: string[];
    category?: string;
    userId?: string;
    outcome?: string;
  }
}

export default new AuditLogRepository();
