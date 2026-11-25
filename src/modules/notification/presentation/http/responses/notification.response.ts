import { z } from '../../../../../shared/presentation/validation/z';
import { GlobalNotificationSchema, NotificationSchema } from './notification-components.response';

// ── Esquemas de salida ──
export const NotificationMixedItemSchema = z
  .union([
    NotificationSchema.extend({ type: z.literal('personal') }),
    GlobalNotificationSchema.extend({ type: z.literal('global') })
  ])
  .meta({ description: 'Ítem de la bandeja: `type` personal = notificación del usuario; global = aviso para todos.' });

export const UnreadCountSchema = z.object({ count: z.number().int().meta({ example: 3 }) });

// `estadoSolicitud` es el contrato heredado con los servicios externos.
export const NotificationCreatedSchema = z.object({
  estadoSolicitud: z.literal(1),
  message: z.string(),
  notificationId: z.uuid().optional().meta({ description: 'Si la notificación fue para un usuario.' }),
  globalNotificationId: z.uuid().optional().meta({ description: 'Si fue global (sin userId).' })
});
export type NotificationCreated = z.infer<typeof NotificationCreatedSchema>;
