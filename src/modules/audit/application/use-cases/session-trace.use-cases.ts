// Casos de uso de la traza forense de sesiones: el listado de sesiones (con cuántas acciones tuvo cada una),
// la línea de tiempo de una sesión y la hidratación por lote de las filas de dominio que tocó.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { appliedFilters, pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import { SessionNotFoundError } from '../../domain/errors';
import { hasDetail, idsByTable } from '../../domain/session-trace';
import type { AuditLogRepository } from '../ports/audit-log-repository.port';
import type { SessionDirectory } from '../ports/session-directory.port';
import type { TracedEntityRegistry } from '../ports/traced-entity-source.port';
import {
  toSessionEntitiesOutput,
  toSessionHeaderOutput,
  toTimelineEventOutput,
  type EntityGroupOutput
} from '../dto/trace.output';
import { SESSION_ENTITY } from './audit-entities';

export type SessionListQuery = PageQuery & {
  userId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  ip?: string | null;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
};

export class ListSessionTraces {
  constructor(
    private readonly sessions: SessionDirectory,
    private readonly logs: AuditLogRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: SessionListQuery }) {
    const page = pageRequest(query);
    const filters = {
      userId: query.userId ?? undefined,
      sessionId: query.sessionId ?? undefined,
      status: query.status ?? undefined,
      ip: query.ip ?? undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined
    };
    const { rows, count } = await this.sessions.list(filters, page);
    // Acciones por sesión, solo de las sesiones de esta página (una consulta agrupada)
    const actions = await this.logs.countBySessions(rows.map(s => s.sessionId));
    const activeFilters = appliedFilters(filters);

    await this.audit.record('SESSION_TRACE_LIST_VIEWED', {
      actorId,
      details: { totalItems: count, filters: Object.keys(activeFilters) },
      ...SESSION_ENTITY
    });

    return {
      data: rows.map(s => toSessionHeaderOutput(s, actions.get(s.sessionId) ?? 0)),
      metadata: pageMetadata(page, count, activeFilters)
    };
  }
}

export class GetSessionTimeline {
  constructor(
    private readonly sessions: SessionDirectory,
    private readonly logs: AuditLogRepository,
    private readonly entities: TracedEntityRegistry,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, sessionId, query }: { actorId: string; sessionId: string; query: PageQuery }) {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw new SessionNotFoundError();
    }
    const page = pageRequest(query);
    const { rows, count } = await this.logs.findBySession(sessionId, page);

    await this.audit.record('SESSION_TRACE_VIEWED', {
      actorId,
      details: { sessionId, totalItems: count },
      entityId: sessionId,
      ...SESSION_ENTITY
    });

    const hydratable = new Set(Object.keys(this.entities));
    return {
      session: toSessionHeaderOutput(session, count),
      timeline: rows.map(log => toTimelineEventOutput(log, hasDetail(log, hydratable))),
      metadata: pageMetadata(page, count)
    };
  }
}

export class GetSessionEntities {
  constructor(
    private readonly sessions: SessionDirectory,
    private readonly logs: AuditLogRepository,
    private readonly entities: TracedEntityRegistry,
    private readonly audit: AuditTrail
  ) {}

  /** Los ids salen de audit_logs, nunca del usuario; `entityTable` acota a una tabla ("expandir una fila"). */
  async execute({ actorId, sessionId, entityTable }: { actorId: string; sessionId: string; entityTable?: string | null }) {
    if (!(await this.sessions.exists(sessionId))) {
      throw new SessionNotFoundError();
    }
    const refs = await this.logs.findEntityRefsBySession(sessionId);

    const groups: EntityGroupOutput[] = [];
    const skipped: Array<{ entityTable: string; count: number }> = [];
    for (const [table, ids] of idsByTable(refs, entityTable || null)) {
      const source = this.entities[table];
      if (!source) {
        skipped.push({ entityTable: table, count: ids.length });
        continue;
      }
      const items = await source.findByIds(ids);
      groups.push({ entityTable: table, entityType: source.entityType, count: items.length, items });
    }

    await this.audit.record('SESSION_TRACE_ENTITIES_VIEWED', {
      actorId,
      details: { sessionId, tables: groups.map(g => g.entityTable), skipped: skipped.map(s => s.entityTable) },
      entityId: sessionId,
      ...SESSION_ENTITY
    });

    return toSessionEntitiesOutput(sessionId, groups, skipped);
  }
}
