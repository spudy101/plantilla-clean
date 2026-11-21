// config/swagger/modules/shared-endpoints/notification/notification.paths.ts

import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { NotificationCreatedSchema } from '../responses/notification.response';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import { CreateNotificationBody, GlobalNotificationListQuery, NotificationFeedQuery, PersonalNotificationListQuery } from '../requests/notification.request';
import { NotificationMixedItemSchema, UnreadCountSchema } from '../responses/notification.response';

/**
 * ============================================================
 * NOTIFICATION PATHS — SHARED ENDPOINTS
 * ============================================================
 * Disponible en: servidor client y servidor admin
 * Autenticación estándar: bearerAuth + idTokenAuth
 * Excepción: POST /notifications usa X-API-Key (apiKeyAuth)
 *
 * Rutas:
 *   GET  /client/api/v1/notification/count/stream         → SSE: stream de no leídas en tiempo real
 *   GET  /client/api/v1/notification/count                → conteo puntual
 *   POST /client/api/v1/notification/notifications        → creación externa vía X-API-Key
 *   GET  /client/api/v1/notification/notifications        → bandeja mixta paginada (personal + global)
 *   GET  /client/api/v1/notification/notifications/personal → solo notificaciones personales
 *   GET  /client/api/v1/notification/notifications/global   → solo notificaciones globales
 */

// ─── Schemas propios del módulo ───────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  NotificationCreateRequest: toOpenApi(CreateNotificationBody),
  NotificationMixedItem: toOpenApi(NotificationMixedItemSchema, 'output'),
  UnreadCountResponse: toOpenApi(UnreadCountSchema, 'output'),
  NotificationCreated: toOpenApi(NotificationCreatedSchema, 'output')
};

// ─── Parámetros de paginación comunes ────────────────────────

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // ── GET /client/api/v1/notification/count/stream — SSE ───────
  '/client/api/v1/notification/count/stream': {
    get: {
      tags: ['Notifications'],
      summary: 'Stream en tiempo real del conteo de no leídas (SSE)',
      operationId: 'streamUnreadCount',
      description: [
        'Establece una conexión **Server-Sent Events (SSE)** permanente.',
        '',
        'Al conectarse se emite el conteo inicial de notificaciones no leídas. Cada vez que el',
        'conteo cambia (nueva notificación recibida, notificación leída) se emite un nuevo evento:',
        '```',
        'data: {"count":5}',
        '',
        '```',
        'El cliente debe cerrar la conexión (`EventSource.close()`) cuando ya no la necesite.',
        '',
        '⚠️ Este endpoint **no devuelve JSON** — el `Content-Type` es `text/event-stream`.'
      ].join('\n'),
      responses: {
        200: {
          description: 'Stream SSE establecido. La conexión se mantiene abierta.',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                example: 'data: {"count":5}\n\n'
              }
            }
          }
        },
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/notification/count ────────────────────
  '/client/api/v1/notification/count': {
    get: {
      tags: ['Notifications'],
      summary: 'Conteo puntual de notificaciones no leídas',
      operationId: 'getUnreadCount',
      description:
        'Devuelve el total actual de notificaciones no leídas del usuario autenticado (personales + globales). Usar `GET /notifications/count/stream` para recibir actualizaciones en tiempo real sin polling.',
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/UnreadCountResponse' },
          'Conteo de notificaciones no leídas obtenido exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── POST /client/api/v1/notification/notifications (X-API-Key) + GET (mixta) ──
  '/client/api/v1/notification/notifications': {
    post: {
      tags: ['Notifications'],
      summary: 'Crear notificación (uso exclusivo de servicios externos)',
      operationId: 'createNotification',
      security: [{ apiKeyAuth: [] }],
      description: [
        '**Autenticación:** `X-API-Key` (header `x-api-key`). No requiere JWT.',
        '',
        'Endpoint destinado a servicios internos o externos que necesiten disparar una notificación',
        'para un usuario. El tipo de notificación (`tipoNotificacion`) debe existir en la tabla',
        '`notification_types` con el `code` indicado.',
        '',
        'La notificación se encola en el worker y se envía según la configuración del tipo',
        '(push, email) y las preferencias del usuario destinatario.',
        '',
        commonResponses.IDEMPOTENCY_DESCRIPTION
      ].join('\n'),
      parameters: [commonResponses.IdempotencyKeyHeader],
      requestBody: jsonBody('NotificationCreateRequest'),
      responses: {
        201: commonResponses.created(
          { $ref: '#/components/schemas/NotificationCreated' },
          'Notificación encolada exitosamente en el worker de notificaciones.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.RequestInProgress,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError,
        ...commonResponses.ServiceUnavailable
      }
    },

    get: {
      tags: ['Notifications'],
      summary: 'Bandeja mixta de notificaciones paginada (personal + global)',
      operationId: 'getNotificationsList',
      description: [
        'Devuelve las notificaciones personales y globales mezcladas, ordenadas por fecha.',
        '',
        'Las notificaciones de la página actual se marcan automáticamente como leídas.',
        '',
        'Cada ítem incluye el campo `type` para discriminar entre `personal` y `global`.'
      ].join('\n'),
      parameters: toParameters(NotificationFeedQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/NotificationMixedItem' },
          'Bandeja mixta de notificaciones obtenida exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/notification/notifications/personal ───
  '/client/api/v1/notification/notifications/personal': {
    get: {
      tags: ['Notifications'],
      summary: 'Listado de notificaciones personales',
      operationId: 'getPersonalNotifications',
      description:
        'Solo notificaciones dirigidas directamente al usuario autenticado. Soporta búsqueda por título o cuerpo. Las notificaciones de la página se marcan automáticamente como leídas.',
      parameters: toParameters(PersonalNotificationListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/Notification' },
          'Notificaciones personales obtenidas exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── GET /client/api/v1/notification/notifications/global ─────
  '/client/api/v1/notification/notifications/global': {
    get: {
      tags: ['Notifications'],
      summary: 'Listado de notificaciones globales',
      operationId: 'getGlobalNotifications',
      description: [
        'Notificaciones emitidas para todos los usuarios (o un rol objetivo).',
        '',
        'El campo `isRead` refleja si el usuario autenticado ya leyó esa notificación global.',
        'Las notificaciones de la página se marcan como leídas automáticamente.'
      ].join('\n'),
      parameters: toParameters(GlobalNotificationListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/GlobalNotification' },
          'Notificaciones globales obtenidas exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
