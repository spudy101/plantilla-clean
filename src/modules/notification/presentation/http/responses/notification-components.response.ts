// Esquemas Zod de salida de los bloques del módulo (client y admin): tipan y documentan lo que arma
// application/dto/notification.output.ts. Nunca duplicarlos.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

const maskedMetadata = z
  .record(z.string(), z.unknown())
  .nullable()
  .meta({ description: 'Variables del mensaje (JSON). Los datos personales salen enmascarados.' });

export const NotificationCategorySchema = z.object({
  notificationCategoryId: z.uuid(),
  code: z.string().meta({ example: 'SECURITY' }),
  name: z.string().meta({ example: 'Seguridad' }),
  description: z.string().nullable(),
  supportsPush: z.boolean(),
  supportsEmail: z.boolean(),
  supportsSms: z.boolean(),
  isCritical: z
    .boolean()
    .meta({ description: 'true: se envía siempre, sin mirar las preferencias ni el horario de silencio del usuario.' }),
  isActive: z.boolean(),
  emailLayoutTemplate: z.string().nullable().optional().meta({ description: 'Layout HTML del email. Solo en el panel admin.' })
});

export const NotificationTypeSchema = z.object({
  notificationTypeId: z.uuid(),
  code: z.string().meta({ example: 'OPERATION_APPROVED' }),
  name: z.string().meta({ example: 'Operación aprobada' }),
  description: z.string().nullable(),
  notificationCategoryId: z.uuid().nullable(),
  isActive: z.boolean(),
  category: NotificationCategorySchema.nullable()
    .optional()
    .meta({ description: 'Categoría: de ella salen los canales, la criticidad y el layout del email.' })
});

export const NotificationSchema = z.object({
  notificationId: z.uuid(),
  userId: z.uuid(),
  notificationTypeId: z.uuid().nullable(),
  title: z.string().meta({ example: 'Tu solicitud fue aprobada' }),
  body: z.string().meta({ example: 'Revisa los detalles en la app.' }),
  relatedEntityType: z.string().nullable().meta({ example: 'operation' }),
  relatedEntityId: z.string().nullable(),
  metadata: maskedMetadata,
  isRead: z.boolean(),
  readAt: dateTime().nullable(),
  createdAt: dateTime(),
  notificationType: NotificationTypeSchema.optional()
});

export const GlobalNotificationSchema = z.object({
  globalNotificationId: z.uuid(),
  notificationTypeId: z.uuid().nullable(),
  title: z.string(),
  body: z.string(),
  metadata: maskedMetadata,
  sendPush: z.boolean(),
  sendEmail: z.boolean(),
  createdAt: dateTime(),
  isRead: z.boolean().optional().meta({ description: 'Si el usuario actual ya la leyó.' }),
  notificationType: NotificationTypeSchema.optional()
});

