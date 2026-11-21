import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import { SessionTimelineQuery, SessionEntitiesQuery, SessionIdParams, SessionListQuery } from '../requests/audit.request';
import {
  SessionEntitiesSchema,
  SessionTimelineEventSchema,
  SessionTraceListItemSchema
} from '../responses/admin-session-trace.response';

/**
 * ============================================================
 * SESSION TRACE PATHS — ADMIN  (Fase 5 — API admin de sesiones / trazabilidad)
 * ============================================================
 * Módulo: /admin/api/v1/records/audit/sessions
 * RBAC: globalLogs (READ) — mismo módulo que /records/audit/audit-logs.
 * Roles: SUPERADMIN, AUDITOR_INTERNO (solo lectura).
 *
 * Superficie forense (NO confundir con /auth/sessions, que es *control* de sesión).
 * El timeline sale de audit_logs (session_id + entity_table/entity_id); la hidratación reusa
 * los DTOs admin existentes, un findAll por tabla involucrada.
 *
 * Rutas:
 *   GET /admin/api/v1/records/audit/sessions
 *   GET /admin/api/v1/records/audit/sessions/{sessionId}
 *   GET /admin/api/v1/records/audit/sessions/{sessionId}/entities
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  SessionTraceListItem: toOpenApi(SessionTraceListItemSchema, 'output'),
  SessionTimelineEvent: toOpenApi(SessionTimelineEventSchema, 'output'),
  SessionTimelineResponse: {
    type: 'object',
    description: 'Cabecera de la sesión + timeline cronológico paginado.',
    properties: {
      session: { $ref: '#/components/schemas/SessionTraceListItem' },
      timeline: { type: 'array', items: { $ref: '#/components/schemas/SessionTimelineEvent' } },
      metadata: { $ref: '#/components/schemas/Metadata' }
    }
  },
  SessionEntitiesResponse: toOpenApi(SessionEntitiesSchema, 'output')
};

const paths = {
  '/admin/api/v1/records/audit/sessions': {
    get: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Listar sesiones con conteo de acciones (paginado)',
      operationId: 'adminListSessionTraces',
      description: `Listado forense de sesiones (join \`user_sessions\`) con el **conteo de acciones** que cada una
originó en \`audit_logs\`.

**Acceso:** SUPERADMIN y AUDITOR_INTERNO (solo lectura). Módulo RBAC \`globalLogs\`.

No confundir con \`/auth/sessions\` (módulo \`activeSessions\`), que es *control* de sesión (ver/revocar).`,
      parameters: toParameters(SessionListQuery, 'query'),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/SessionTraceListItem' }, 'Sesiones obtenidas exitosamente.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/sessions/{sessionId}': {
    get: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Traza (timeline) de una sesión',
      operationId: 'adminGetSessionTrace',
      description: `Cabecera de la sesión + **timeline cronológico** (ascendente por \`created_at\`) de todas las
acciones registradas en \`audit_logs\` para esa sesión. Cada evento trae \`entityTable\` + \`entityId\` y un flag
\`hasDetail\` que indica si su fila de dominio es hidratable vía \`/sessions/{sessionId}/entities\`.`,
      parameters: [...toParameters(SessionIdParams, 'path'), ...toParameters(SessionTimelineQuery, 'query')],
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/SessionTimelineResponse' },
          'Traza de sesión obtenida exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/sessions/{sessionId}/entities': {
    get: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Hidratar las filas de dominio de una sesión',
      operationId: 'adminGetSessionEntities',
      description: `Hidratación **perezosa y por lote** de las filas de dominio referenciadas por el timeline de la
sesión: agrupa por tabla y hace **un \`findAll\` por tabla involucrada**, reusando los DTOs admin existentes. Los ids
se derivan de \`audit_logs\` (nunca de input del usuario). Las tablas aún no registradas en el registry vuelven en
\`skipped\`.`,
      parameters: [...toParameters(SessionIdParams, 'path'), ...toParameters(SessionEntitiesQuery, 'query')],
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/SessionEntitiesResponse' },
          'Entidades de la sesión obtenidas exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
