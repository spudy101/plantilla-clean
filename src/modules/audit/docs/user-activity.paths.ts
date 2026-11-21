// config/swagger/modules/client/records/audit/user-activity.paths.ts

import commonResponses from '../../../config/swagger/responses/common.responses';
import { toOpenApi, toParameters } from '../../../shared/validation/openapi';
import { RecentActivityQuery } from '../requests/audit.request';
import { UserActivityItemSchema } from '../responses/user-activity.response';

/**
 * ============================================================
 * USER ACTIVITY PATHS — CLIENT
 * ============================================================
 * Módulo: /client/api/v1/records/audit/recent-activity
 * Feed de actividad reciente del PROPIO usuario autenticado (roles CLIENTE / CLIENTE_VERIFICADO).
 *
 * Client-safe: mezcla las acciones del propio usuario y los cambios sobre su cuenta (ambos en `audit_logs`; cambios de
 * cuenta/perfil, incluidos los hechos por un admin o por el sistema) SIN exponer nunca `details`
 * (before/after), `previous_value`/`new_value`, user_agent ni datos de terceros.
 *
 * Rutas:
 *   GET /client/api/v1/records/audit/recent-activity
 */

const clientSecurity = [{ bearerAuth: [], idTokenAuth: [] }];

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  UserActivityItem: toOpenApi(UserActivityItemSchema, 'output')
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/client/api/v1/records/audit/recent-activity': {
    get: {
      tags: ['Cliente — Actividad Reciente'],
      summary: 'Actividad reciente del propio usuario',
      operationId: 'clientGetRecentActivity',
      description: `Feed paginado de la actividad reciente del usuario autenticado, del evento más reciente al más antiguo.

Fusiona dos fuentes (campo \`source\` de cada ítem):
- \`audit_log\` → acciones ejecutadas por el propio usuario (login, consultas, operaciones).
- \`user_change_log\` → cambios en los datos de su cuenta/perfil; \`changedByRole\` indica si lo hizo el propio usuario, un administrador o el sistema.

**Client-safe:** nunca expone el detalle técnico de los cambios (valores anteriores/nuevos), user agent ni datos de terceros — solo el código de la acción, una descripción legible y el desenlace.`,
      security: clientSecurity,
      parameters: toParameters(RecentActivityQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/UserActivityItem' },
          'Actividad reciente obtenida exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
