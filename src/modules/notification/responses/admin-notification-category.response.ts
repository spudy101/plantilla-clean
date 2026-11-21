import type { PageMetadata } from '../../../shared/application/pagination';
import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import { NotificationCategorySchema } from './notification-components.response';
import type { NotificationCategoryRow } from '../repositories/notification-category.repository';
import componentsNotificationDtoModule from './notification-components.response';
const { NotificationCategoryComponent } = componentsNotificationDtoModule;

// El admin ve el layout de email completo (includeLayout = true).

function NotificationCategoryAdminDTO(category: NotificationCategoryRow, extra: Record<string, unknown> = {}) {
  return {
    ...NotificationCategoryComponent.build(category, true),
    ...extra,
    updatedAt: category.updatedAt
  };
}

function ListNotificationCategoriesResponseDTO(
  rows: NotificationCategoryRow[],
  metadata: PageMetadata
) {
  return {
    data: Array.isArray(rows) ? rows.map(r => NotificationCategoryAdminDTO(r)) : [],
    metadata
  };
}

export default {
  NotificationCategoryAdminDTO,
  ListNotificationCategoriesResponseDTO
};

// ── Esquemas de salida ──
export const NotificationCategoryAdminSchema = NotificationCategorySchema.extend({
  emailLayoutTemplate: z.string().nullable().meta({ description: 'Layout HTML del email ({{content}} = cuerpo del tipo).' }),
  updatedAt: dateTime()
});

export const NotificationCategoryDeletedSchema = z.object({ notificationCategoryId: z.uuid(), deleted: z.literal(true) });
export type NotificationCategoryDeleted = z.infer<typeof NotificationCategoryDeletedSchema>;
