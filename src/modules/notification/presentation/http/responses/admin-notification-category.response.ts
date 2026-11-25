import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import { NotificationCategorySchema } from './notification-components.response';

// El admin ve el layout de email completo.
// ── Esquemas de salida ──
export const NotificationCategoryAdminSchema = NotificationCategorySchema.extend({
  emailLayoutTemplate: z.string().nullable().meta({ description: 'Layout HTML del email ({{content}} = cuerpo del tipo).' }),
  updatedAt: dateTime()
});

export const NotificationCategoryDeletedSchema = z.object({ notificationCategoryId: z.uuid(), deleted: z.literal(true) });
export type NotificationCategoryDeleted = z.infer<typeof NotificationCategoryDeletedSchema>;
