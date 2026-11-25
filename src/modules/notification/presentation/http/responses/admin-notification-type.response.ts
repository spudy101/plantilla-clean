import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import { NotificationTypeSchema } from './notification-components.response';

// El admin ve las plantillas completas: campos que el cliente nunca ve.
// ── Esquemas de salida ──
export const NotificationTypeAdminSchema = NotificationTypeSchema.extend({
  titleTemplate: z.string().meta({ example: 'Hola {{nombre}}' }),
  bodyTemplate: z.string(),
  emailSubjectTemplate: z.string().nullable(),
  emailBodyTemplate: z.string().nullable(),
  updatedAt: dateTime()
});

const queued = {
  titulo: z.string(),
  contenido: z.string(),
  asunto: z.string().nullish(),
  processingStatus: z.literal('queued').meta({ description: 'El envío se procesa en segundo plano.' }),
  createdAt: dateTime()
};

export const GlobalNotificationQueuedSchema = z.object({ globalNotificationId: z.uuid(), ...queued });
export const DirectNotificationQueuedSchema = z.object({ notificationId: z.uuid(), userId: z.uuid(), ...queued });
