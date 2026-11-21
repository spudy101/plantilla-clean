import type SessionTraceDto from '../responses/admin-session-trace.response';
// Fase 5 — API admin de sesiones (el consumidor de la trazabilidad).
// Superficie forense: dada una sesión, reconstruye qué se hizo en ella y con qué filas de dominio.
//
// Encuadre (§8.2 del PLAN-TRAZABILIDAD-SESION): la fuente del timeline es audit_logs (session_id +
// entity_table/entity_id), NO un fan-out a 50 tablas. La columna origin_session_id es red de seguridad
// (índice inverso / cobertura / durabilidad), no la fuente. La hidratación es perezosa y por lote:
// un findAll por tabla involucrada, agrupando los ids, reusando los DTOs admin que ya existen.

import AppError from '../../../shared/http/app-error.util';

import auditLogRepository from '../repositories/audit-log.repository';
import iamModule from '../../iam';
const { userSessionRepository, trustedDeviceRepository: trustedDeviceRepo } = iamModule;
import legalModule from '../../legal';
const { userConsentRepository, legalComponentsDto } = legalModule;
// eslint-disable-next-line max-len
import notificationModule from '../../notification';
const { notificationPreferenceRepository: notificationPreferenceRepo } = notificationModule;
import componentsAuditDtoModule from '../responses/audit-components.response';
const {
  NotificationPreferenceComponent,
  TrustedDeviceComponent
} = componentsAuditDtoModule;
const { UserConsentComponent } = legalComponentsDto;
import adminSessionTraceDtoModule from '../responses/admin-session-trace.response';
const { SessionTraceListDTO, SessionTimelineDTO, SessionEntitiesDTO } = adminSessionTraceDtoModule;
import audit from '../audit.service';
import { appliedFilters, pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { SessionListQuery, SessionTimelineQuery } from '../requests/audit.request';

// ============================================================
// REGISTRY — mapa entity_table → { repository, pk, entityType, dto } declarado en UN solo lugar (§8.4).
// Extensible: cada dominio que quieras hidratar en la trazabilidad suma su tabla aquí; el resto del
// feature no cambia. Las tablas no registradas caen en `skipped` y sus eventos llevan hasDetail=false.
// PII: estos DTOs enmascaran por defecto y esta vista NO es self-view — no se usa unmask. Al sumar una
// tabla con datos sensibles (dirección, teléfono, token), enmascará/omití esos campos en su component.
// ============================================================
/** Entrada del registry: cómo traer las filas de una tabla y cómo serializarlas. */
interface RegistryEntry<R> {
  repository: { findByIds(ids: string[], field: string): Promise<R[]> };
  pk: string;
  entityType: string;
  dto: (row: R) => unknown;
}

// Cada entrada se valida con su propio tipo de fila (R) y se guarda borrado: el registry es heterogéneo.
function _entry<R>(entry: RegistryEntry<R>): RegistryEntry<unknown> {
  return entry as unknown as RegistryEntry<unknown>;
}

const ENTITY_REGISTRY: Record<string, RegistryEntry<unknown> | undefined> = {
  user_consents: _entry({
    repository: userConsentRepository,
    pk: 'userConsentId',
    entityType: 'UserConsent',
    dto: r => UserConsentComponent.build(r)
  }),
  user_notification_preferences: _entry({
    repository: notificationPreferenceRepo,
    pk: 'userNotificationPreferenceId',
    entityType: 'UserNotificationPreference',
    dto: r => NotificationPreferenceComponent.build(r)
  }),
  user_trusted_devices: _entry({
    repository: trustedDeviceRepo,
    pk: 'userTrustedDeviceId',
    entityType: 'UserTrustedDevice',
    dto: r => TrustedDeviceComponent.build(r)
  })
};

function _isHydratable(entityTable: string | null, entityId: string | null) {
  return Boolean(entityTable && entityId && ENTITY_REGISTRY[entityTable]);
}

class AdminSessionTraceService {
  auditLogRepository: typeof auditLogRepository;
  userSessionRepository: typeof userSessionRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AdminSessionTraceService({ auditLogRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: AdminSessionTraceService.Deps = {}) {
    this.auditLogRepository = deps.auditLogRepository ?? auditLogRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
  }

  // GET /records/audit/sessions — listado paginado de sesiones con conteo de acciones por sesión.
  async listSessions(query: SessionListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = {
      userId: query.userId ?? undefined,
      sessionId: query.sessionId ?? undefined,
      status: query.status ?? undefined,
      ip: query.ip ?? undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined
    };
    const where = this.userSessionRepository.buildWhere(filters);

    const { rows, count } = await this.userSessionRepository.findPaginatedWithDeviceAndUser(where, page);

    // Conteo de acciones por sesión, solo para las sesiones de esta página (un query agrupado).
    const sessionIds = rows.map(s => s.userSessionId);
    const counts = await this.auditLogRepository.countBySessionIds(sessionIds);
    const countMap = new Map(counts.map(row => [row.sessionId, row.count]));

    const activeFilters = appliedFilters(filters);

    await audit.record('SESSION_TRACE_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, filters: Object.keys(activeFilters) },
      entityType: 'AuthSession',
      entityTable: 'user_sessions'
    });

    return SessionTraceListDTO(rows, countMap, pageMetadata(page, count, activeFilters));
  }

  // GET /records/audit/sessions/:sessionId — cabecera + timeline cronológico de audit_logs.
  async getSessionTimeline(sessionId: string, query: SessionTimelineQuery, adminUserId: string) {
    const session = await this.userSessionRepository.findByIdWithDeviceAndUser(sessionId);
    if (!session) {
      throw AppError.notFound('Sesión no encontrada');
    }

    const page = pageRequest(query);
    const { rows, count } = await this.auditLogRepository.findPaginatedWithExecutor({ sessionId }, page);

    await audit.record('SESSION_TRACE_VIEWED', {
      actorId: adminUserId,
      details: { sessionId, totalItems: count },
      entityId: sessionId,
      entityType: 'AuthSession',
      entityTable: 'user_sessions'
    });

    return SessionTimelineDTO(
      session,
      count,
      rows,
      pageMetadata(page, count),
      log => _isHydratable(log.entityTable, log.entityId)
    );
  }

  // GET /records/audit/sessions/:sessionId/entities — hidratación por lote de las filas de dominio
  // referenciadas por el timeline. Un findAll por tabla involucrada; ids derivados de audit_logs
  // (nunca de input del usuario). ?entityTable= acota a una sola tabla (caso "expandir una fila").
  async getSessionEntities(sessionId: string, query: Record<string, unknown>, adminUserId: string) {
    const exists = await this.userSessionRepository.findById(sessionId);
    if (!exists) {
      throw AppError.notFound('Sesión no encontrada');
    }

    let refs = await this.auditLogRepository.findEntityRefsBySession(sessionId);
    const entityTableFilter = typeof query.entityTable === 'string' && query.entityTable ? query.entityTable : null;
    if (entityTableFilter) {
      refs = refs.filter(r => r.entityTable === entityTableFilter);
    }

    // Agrupar ids únicos por tabla.
    const idsByTable: Record<string, Set<string>> = {};
    for (const ref of refs) {
      (idsByTable[ref.entityTable] ??= new Set()).add(ref.entityId);
    }

    const entities: SessionTraceDto.EntityGroup[] = [];
    const skipped: Array<{ entityTable: string; count: number }> = [];

    for (const [entityTable, idSet] of Object.entries(idsByTable)) {
      const ids = [...idSet];
      const entry = ENTITY_REGISTRY[entityTable];
      if (!entry) {
        skipped.push({ entityTable, count: ids.length });
        continue;
      }
      const domainRows = await entry.repository.findByIds(ids, entry.pk);
      entities.push({
        entityTable,
        entityType: entry.entityType,
        count: domainRows.length,
        items: domainRows.map(entry.dto)
      });
    }

    await audit.record('SESSION_TRACE_ENTITIES_VIEWED', {
      actorId: adminUserId,
      details: { sessionId, tables: entities.map(e => e.entityTable), skipped: skipped.map(s => s.entityTable) },
      entityId: sessionId,
      entityType: 'AuthSession',
      entityTable: 'user_sessions'
    });

    return SessionEntitiesDTO(sessionId, entities, skipped);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminSessionTraceService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    auditLogRepository?: typeof auditLogRepository;
    userSessionRepository?: typeof userSessionRepository;
  }
}

export default Object.assign(new AdminSessionTraceService(), { AdminSessionTraceService });
