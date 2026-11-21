import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import type { DeliveryWithNotification } from '../repositories/notification-delivery.repository';
import MaskingUtil from '../../../shared/infrastructure/security/masking.util';

/** Una entrega con lo justo de su notificación para que soporte responda "¿le llegó?". */
function NotificationDeliveryListDTO(record: DeliveryWithNotification) {
  const { notification } = record;
  const type = notification.notificationType;
  return {
    notificationDeliveryId: record.notificationDeliveryId,
    notificationId: record.notificationId,
    userId: notification.userId,
    title: notification.title,
    channel: record.channel,
    status: record.status,
    attempts: record.attempts,
    nextAttemptAt: record.nextAttemptAt,
    sentAt: record.sentAt,
    lastError: record.lastError,
    lastErrorCode: record.lastErrorCode,
    notificationType: type
      ? {
          code: type.code,
          name: type.name,
          category: type.category
            ? { code: type.category.code, name: type.category.name, isCritical: type.category.isCritical }
            : null
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function NotificationDeliveryDetailDTO(record: DeliveryWithNotification) {
  const { notification } = record;
  return {
    ...NotificationDeliveryListDTO(record),
    body: notification.body,
    // [RF-USR-01] | CA-06 | El metadata lleva el correo real del titular → redactor profundo por key.
    metadata: MaskingUtil.redactPayload(notification.metadata) || null,
    relatedEntityType: notification.relatedEntityType,
    relatedEntityId: notification.relatedEntityId,
    notificationCreatedAt: notification.createdAt
  };
}

export default { NotificationDeliveryListDTO, NotificationDeliveryDetailDTO };

// ── Esquemas de salida ──
export const NotificationDeliveryItemSchema = z.object({
  notificationDeliveryId: z.uuid(),
  notificationId: z.uuid(),
  userId: z.uuid(),
  title: z.string(),
  channel: z.enum(['push', 'email', 'sms']),
  status: z.enum(['pending', 'sent', 'failed', 'skipped']).meta({
    description:
      'pending: por enviar o reintentando · sent · failed: rebote definitivo o intentos agotados · skipped: sin destinatario.'
  }),
  attempts: z.number().int(),
  nextAttemptAt: dateTime().nullable().meta({ description: 'Próximo intento si sigue pendiente.' }),
  sentAt: dateTime().nullable(),
  lastError: z.string().nullable(),
  lastErrorCode: z.string().nullable().meta({ example: 'MessageRejected' }),
  notificationType: z
    .object({
      code: z.string().meta({ example: 'OPERATION_APPROVED' }),
      name: z.string(),
      category: z.object({ code: z.string(), name: z.string(), isCritical: z.boolean() }).nullable()
    })
    .nullable(),
  createdAt: dateTime(),
  updatedAt: dateTime()
});

export const NotificationDeliveryDetailSchema = NotificationDeliveryItemSchema.extend({
  body: z.string(),
  metadata: z
    .record(z.string(), z.unknown())
    .nullable()
    .meta({ description: 'Variables del mensaje. Los datos personales salen enmascarados.' }),
  relatedEntityType: z.string().nullable(),
  relatedEntityId: z.string().nullable(),
  notificationCreatedAt: dateTime()
});
