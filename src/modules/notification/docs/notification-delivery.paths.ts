import commonResponses from '../../../config/swagger/responses/common.responses';
import { toOpenApi, toParameters } from '../../../shared/validation/openapi';
import { DeliveryIdParams, DeliveryListQuery } from '../requests/notification.request';
import {
  NotificationDeliveryDetailSchema,
  NotificationDeliveryItemSchema
} from '../responses/admin-notification-delivery.response';

/**
 * ============================================================
 * NOTIFICATION DELIVERY PATHS — ADMIN (solo consulta)
 * ============================================================
 * Una entrega = una notificación por un canal externo (push/email/sms). Los reintentos son
 * automáticos (docs/notifications.md); no hay reenvío manual. Permiso: notificationDeliveries + READ.
 *
 * Rutas:
 *   GET /admin/api/v1/notification/notification-delivery
 *   GET /admin/api/v1/notification/notification-delivery/:id
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  NotificationDeliveryItem: toOpenApi(NotificationDeliveryItemSchema, 'output'),
  NotificationDeliveryDetail: toOpenApi(NotificationDeliveryDetailSchema, 'output')
};

const paths = {
  '/admin/api/v1/notification/notification-delivery': {
    get: {
      tags: ['Admin — Auditoría / Entregas de Notificación'],
      summary: 'Listar entregas de notificaciones',
      description:
        'Lista paginada de entregas por canal (push, email, sms), las más recientes primero. ' +
        'Filtros: estado, canal, usuario destinatario y rango de fechas.\n\n' +
        '**Acceso:** permiso notificationDeliveries:READ.',
      operationId: 'adminListNotificationDelivery',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      parameters: toParameters(DeliveryListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/NotificationDeliveryItem' },
          'Entregas de notificaciones obtenidas exitosamente.'
        ),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/notification/notification-delivery/{id}': {
    get: {
      tags: ['Admin — Auditoría / Entregas de Notificación'],
      summary: 'Detalle de una entrega de notificación',
      description:
        'Detalle de una entrega: estado, intentos, último error del proveedor y el contenido de la ' +
        'notificación (datos personales enmascarados).\n\n' +
        '**Acceso:** permiso notificationDeliveries:READ.',
      operationId: 'adminGetNotificationDeliveryById',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      parameters: toParameters(DeliveryIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/NotificationDeliveryDetail' }, 'Entrega obtenida exitosamente.'),
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
