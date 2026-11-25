import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

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
