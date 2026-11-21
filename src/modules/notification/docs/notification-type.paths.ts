// config/swagger/modules/admin/notification/notification-type.paths.ts

import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import {
  DirectNotificationBody,
  GlobalNotificationBody,
  TypeIdParams,
  TypeListQuery,
  UpdateTypeBody
} from '../requests/notification.request';
import {
  DirectNotificationQueuedSchema,
  GlobalNotificationQueuedSchema,
  NotificationTypeAdminSchema
} from '../responses/admin-notification-type.response';

/**
 * ============================================================
 * NOTIFICATION TYPE PATHS — ADMIN
 * ============================================================
 * Módulo: /admin/api/v1/notification/notification-types
 * Todos los endpoints requieren rol ADMIN o SUPER_ADMIN.
 *
 * Rutas:
 *   GET   /admin/api/v1/notification/notification-types
 *   POST  /admin/api/v1/notification/notification-types/global
 *   POST  /admin/api/v1/notification/notification-types/direct
 *   PATCH /admin/api/v1/notification/notification-types/:notificationTypeId
 */

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AdminNotificationType: toOpenApi(NotificationTypeAdminSchema, 'output'),
  AdminNotificationTypeUpdateRequest: toOpenApi(UpdateTypeBody),
  AdminGlobalNotificationRequest: toOpenApi(GlobalNotificationBody),
  AdminGlobalNotificationResponse: toOpenApi(GlobalNotificationQueuedSchema, 'output'),
  AdminDirectNotificationRequest: toOpenApi(DirectNotificationBody),
  AdminDirectNotificationResponse: toOpenApi(DirectNotificationQueuedSchema, 'output')
};

// ─── Parámetros comunes ────────────────────────────────────────

const adminSecurity = [{ bearerAuth: [], idTokenAuth: [] }];

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/admin/api/v1/notification/notification-types': {
    get: {
      tags: ['Admin - Tipos de Notificación'],
      summary: 'Listar tipos de notificación',
      operationId: 'adminListNotificationTypes',
      description: `Lista paginada de tipos de notificación con templates completos (campos que el cliente nunca ve).

Útil para revisar y mantener los templates de email (Handlebars HTML) y push.`,
      security: adminSecurity,
      parameters: toParameters(TypeListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/AdminNotificationType' },
          'Tipos de notificación obtenidos exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/notification/notification-types/global': {
    post: {
      tags: ['Admin - Tipos de Notificación'],
      summary: 'Enviar notificación global',
      operationId: 'adminCreateGlobalNotification',
      description: `Envía una notificación masiva a **todos los clientes** (roles \`CLIENTE\` y \`CLIENTE_VERIFICADO\`).
No se envía a usuarios internos.

La notificación se encola (\`processingStatus: queued\`) y se procesa en background — la respuesta es inmediata pero el envío puede tardar dependiendo del volumen de clientes.

${commonResponses.IDEMPOTENCY_DESCRIPTION}`,
      security: adminSecurity,
      parameters: [commonResponses.IdempotencyKeyHeader],
      requestBody: jsonBody('AdminGlobalNotificationRequest'),
      responses: {
        201: commonResponses.created(
          { $ref: '#/components/schemas/AdminGlobalNotificationResponse' },
          'Notificación global encolada exitosamente'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.RequestInProgress,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/notification/notification-types/direct': {
    post: {
      tags: ['Admin - Tipos de Notificación'],
      summary: 'Enviar notificación directa a un usuario',
      operationId: 'adminCreateDirectNotification',
      description: `Envía una notificación a **un usuario específico** (no global).

El usuario destinatario debe existir y estar **activo**. La notificación se encola (\`processingStatus: queued\`) y se procesa en background respetando las preferencias y quiet hours del usuario.

${commonResponses.IDEMPOTENCY_DESCRIPTION}`,
      security: adminSecurity,
      parameters: [commonResponses.IdempotencyKeyHeader],
      requestBody: jsonBody('AdminDirectNotificationRequest'),
      responses: {
        201: commonResponses.created(
          { $ref: '#/components/schemas/AdminDirectNotificationResponse' },
          'Notificación directa encolada exitosamente'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.RequestInProgress,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/notification/notification-types/{notificationTypeId}': {
    patch: {
      tags: ['Admin - Tipos de Notificación'],
      summary: 'Actualizar tipo de notificación',
      operationId: 'adminUpdateNotificationType',
      description:
        'Actualiza los templates de un tipo de notificación. Todos los campos son opcionales — solo se actualizan los enviados.',
      security: adminSecurity,
      parameters: toParameters(TypeIdParams, 'path'),
      requestBody: jsonBody('AdminNotificationTypeUpdateRequest'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/AdminNotificationType' },
          'Tipo de notificación actualizado exitosamente'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
