import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { SessionRevokedSchema } from '../responses/admin-auth-session.response';
import { toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import {
  AdminSessionListQuery,
  AttemptListQuery,
  AttemptsByUserQuery,
  RevokeSessionParams,
  SessionsByUserQuery,
  UserIdParams
} from '../requests/iam.request';
import { AdminSessionSchema, AuthAttemptSchema } from '../responses/admin-auth-session.response';

/**
 * ============================================================
 * ADMIN AUTH SESSION PATHS  —  RF-ADM-03
 * ============================================================
 * Módulo: /admin/api/v1/auth
 * Roles: GET → ADMIN_ACCESS_ROLES + AUDITOR_INTERNO (solo lectura); PATCH revoke → solo ADMIN_ACCESS_ROLES
 *
 * Rutas:
 *   GET    /admin/api/v1/auth/sessions
 *   GET    /admin/api/v1/auth/sessions/user/:userId
 *   PATCH  /admin/api/v1/auth/sessions/:sessionId/revoke
 *   GET    /admin/api/v1/auth/attempts
 *   GET    /admin/api/v1/auth/attempts/user/:userId
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AdminSession: toOpenApi(AdminSessionSchema, 'output'),
  AuthAttempt: toOpenApi(AuthAttemptSchema, 'output'),
  AdminSessionRevoked: toOpenApi(SessionRevokedSchema, 'output')
};

const paths = {
  '/admin/api/v1/auth/sessions': {
    get: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Listar sesiones (paginado)',
      operationId: 'adminListSessions',
      description:
        'Lista paginada de todas las sesiones de usuario. Soporta filtros por sesión, usuario, estado y rango de fechas.\n\n**Acceso:** SUPERADMIN, ADMIN_PRODUCTOS y AUDITOR_INTERNO (solo lectura).',
      parameters: toParameters(AdminSessionListQuery, 'query'),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/AdminSession' }, 'Lista de sesiones obtenida exitosamente.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/auth/sessions/user/{userId}': {
    get: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Sesiones de un usuario específico',
      operationId: 'adminGetSessionsByUser',
      parameters: [...toParameters(UserIdParams, 'path'), ...toParameters(SessionsByUserQuery, 'query')],
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/AdminSession' }, 'Sesiones del usuario obtenidas.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/auth/sessions/{sessionId}/revoke': {
    patch: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Revocar sesión activa (cierre forzado)',
      operationId: 'adminRevokeSession',
      description: `Cierra forzosamente una sesión activa:
1. Cierra la sesión en BD con razón \`revoked_by_admin\`.
2. Revoca el JTI del refresh token en Redis.
3. Invalida los access tokens **de esa sesión** en Redis (quedan rechazados en el próximo request).

El usuario es deslogueado de esa sesión de forma inmediata. **Las demás sesiones del usuario no se ven afectadas**
(la invalidación es por sesión, no global): si tiene la sesión abierta en otro dispositivo, sigue trabajando ahí.

Si el cliente de la sesión revocada intenta renovar, recibe 401 con \`details.code = SESSION_CLOSED\`.`,
      parameters: toParameters(RevokeSessionParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminSessionRevoked' }, 'Sesión revocada exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/auth/attempts': {
    get: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Historial de intentos de autenticación',
      operationId: 'adminListAttempts',
      description:
        'Lista paginada del log de auditoría de autenticación.\n\n' +
        'Por defecto (`scope=all`) devuelve todos los eventos de la categoría Autenticación ' +
        '(logins, MFA, dispositivos, sesiones, etc.). Con `scope=login` se acota solo a intentos ' +
        'de inicio de sesión. Cada registro incluye el objeto `user` (usuario asociado, o null).',
      parameters: toParameters(AttemptListQuery, 'query'),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/AuthAttempt' }, 'Historial de intentos obtenido.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/auth/attempts/user/{userId}': {
    get: {
      tags: ['Admin - Auditoría / Sesiones'],
      summary: 'Intentos de autenticación de un usuario',
      operationId: 'adminGetAttemptsByUser',
      description:
        'Eventos de autenticación de un usuario específico. Por defecto (`scope=all`) devuelve toda la ' +
        'categoría Autenticación; con `scope=login` se acota solo a intentos de inicio de sesión. ' +
        'Cada registro incluye el objeto `user`.',
      parameters: [...toParameters(UserIdParams, 'path'), ...toParameters(AttemptsByUserQuery, 'query')],
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/AuthAttempt' }, 'Intentos del usuario obtenidos.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
