import commonResponses from '../../../config/swagger/responses/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/validation/openapi';
import { CategoryIdParams, CategoryListQuery, CreateCategoryBody, UpdateCategoryBody } from '../requests/notification.request';
import {
  NotificationCategoryAdminSchema,
  NotificationCategoryDeletedSchema
} from '../responses/admin-notification-category.response';

/**
 * NOTIFICATION CATEGORY PATHS — ADMIN
 * Categorías de notificación: definen los canales permitidos, si el usuario puede silenciarlas (DND), si son
 * críticas y el layout HTML del email. Cada tipo de notificación pertenece a una categoría.
 *
 *   GET    /admin/api/v1/notification/notification-categories                          (notificationManagement:READ)
 *   GET    /admin/api/v1/notification/notification-categories/{notificationCategoryId} (notificationManagement:READ)
 *   POST   /admin/api/v1/notification/notification-categories                          (notificationManagement:CREATE)
 *   PATCH  /admin/api/v1/notification/notification-categories/{notificationCategoryId} (notificationManagement:UPDATE)
 *   DELETE /admin/api/v1/notification/notification-categories/{notificationCategoryId} (notificationManagement:DELETE)
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AdminNotificationCategory: toOpenApi(NotificationCategoryAdminSchema, 'output'),
  AdminNotificationCategoryDeleted: toOpenApi(NotificationCategoryDeletedSchema, 'output'),
  AdminNotificationCategoryCreateRequest: toOpenApi(CreateCategoryBody),
  AdminNotificationCategoryUpdateRequest: toOpenApi(UpdateCategoryBody)
};

const TAG = 'Admin - Notificaciones / Categorías';
const security = [{ bearerAuth: [], idTokenAuth: [] }];
const errors = { ...commonResponses.Unauthorized, ...commonResponses.Forbidden, ...commonResponses.InternalServerError };
const category = { $ref: '#/components/schemas/AdminNotificationCategory' };
const BASE = '/admin/api/v1/notification/notification-categories';

const paths = {
  [BASE]: {
    get: {
      tags: [TAG],
      summary: 'Listar categorías de notificación (paginado)',
      operationId: 'adminListNotificationCategories',
      security,
      parameters: toParameters(CategoryListQuery, 'query'),
      responses: { 200: commonResponses.paginated(category), ...commonResponses.ValidationError, ...errors }
    },
    post: {
      tags: [TAG],
      summary: 'Crear categoría de notificación',
      operationId: 'adminCreateNotificationCategory',
      security,
      requestBody: jsonBody('AdminNotificationCategoryCreateRequest'),
      responses: {
        201: commonResponses.created(category, 'Categoría de notificación creada exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.ValidationError,
        ...errors
      }
    }
  },
  [`${BASE}/{notificationCategoryId}`]: {
    get: {
      tags: [TAG],
      summary: 'Detalle de una categoría de notificación',
      operationId: 'adminGetNotificationCategory',
      security,
      parameters: toParameters(CategoryIdParams, 'path'),
      responses: { 200: commonResponses.ok(category), ...commonResponses.NotFound, ...commonResponses.ValidationError, ...errors }
    },
    patch: {
      tags: [TAG],
      summary: 'Actualizar categoría de notificación',
      description: 'Actualización parcial: solo cambian los campos enviados. El `code` no se puede cambiar.',
      operationId: 'adminUpdateNotificationCategory',
      security,
      parameters: toParameters(CategoryIdParams, 'path'),
      requestBody: jsonBody('AdminNotificationCategoryUpdateRequest'),
      responses: { 200: commonResponses.ok(category), ...commonResponses.NotFound, ...commonResponses.ValidationError, ...errors }
    },
    delete: {
      tags: [TAG],
      summary: 'Eliminar categoría de notificación',
      description: 'Falla con 400 si la categoría todavía tiene tipos de notificación asignados (hay que reasignarlos primero).',
      operationId: 'adminDeleteNotificationCategory',
      security,
      parameters: toParameters(CategoryIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminNotificationCategoryDeleted' }),
        ...commonResponses.NotFound,
        ...commonResponses.BadRequest,
        ...errors
      }
    }
  }
};

export default { paths, schemas };
