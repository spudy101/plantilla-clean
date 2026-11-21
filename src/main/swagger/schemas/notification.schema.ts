// Esquemas globales de notificaciones (los usan los specs admin y client): generados desde los esquemas Zod de
// modules/notification, es decir, desde lo que de verdad arman sus componentes.
import { toOpenApi } from '../../../shared/presentation/validation/openapi';
import {
  GlobalNotificationSchema,
  NotificationCategorySchema,
  NotificationSchema,
  NotificationTypeSchema
} from '../../../modules/notification/responses/notification-components.response';

export default {
  NotificationCategory: toOpenApi(NotificationCategorySchema, 'output'),
  NotificationType: toOpenApi(NotificationTypeSchema, 'output'),
  Notification: toOpenApi(NotificationSchema, 'output'),
  GlobalNotification: toOpenApi(GlobalNotificationSchema, 'output')
};
