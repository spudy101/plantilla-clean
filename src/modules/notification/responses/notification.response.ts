import { z } from '../../../shared/presentation/validation/z';
import { GlobalNotificationSchema, NotificationSchema } from './notification-components.response';
import type * as Feed from '../notification-feed.types';
import componentsNotificationDtoModule from './notification-components.response';
import { pageMetadata } from '../../../shared/application/pagination';
const { NotificationComponent, GlobalNotificationComponent } = componentsNotificationDtoModule;

function _buildMixedItem(item: Feed.FeedItem, readIds: string[]) {
  if (item.__type === 'personal') {
    return {
      type: 'personal',
      ...NotificationComponent.build(item.__instance, { includeType: true })
    };
  }
  return {
    type: 'global',
    ...GlobalNotificationComponent.build(item.__instance, {
      includeType: true,
      isRead: readIds.includes(item.__instance.globalNotificationId)
    })
  };
}

function NotificationsListResponseDTO(result: Feed.MixedListResult) {
  const { mixed, readIds, totalItems, paginationParams } = result;
  return {
    data: Array.isArray(mixed) ? mixed.map(item => _buildMixedItem(item, readIds)) : [],
    metadata: pageMetadata(paginationParams, totalItems)
  };
}

function PersonalNotificationsResponseDTO(result: Feed.PersonalListResult) {
  const { rows, count, paginationParams } = result;
  return {
    data: NotificationComponent.buildArray(Array.isArray(rows) ? rows : [], { includeType: true }),
    metadata: pageMetadata(paginationParams, count)
  };
}

function GlobalNotificationsResponseDTO(result: Feed.GlobalListResult) {
  const { rows, readIds, totalItems, paginationParams } = result;
  return {
    data: Array.isArray(rows)
      ? rows.map(item =>
          GlobalNotificationComponent.build(item.__instance, {
            includeType: true,
            isRead: readIds.includes(item.__instance.globalNotificationId)
          })
        )
      : [],
    metadata: pageMetadata(paginationParams, totalItems)
  };
}

function UnreadCountResponseDTO(count: number) {
  return { count };
}

export default {
  NotificationsListResponseDTO,
  PersonalNotificationsResponseDTO,
  GlobalNotificationsResponseDTO,
  UnreadCountResponseDTO
};

// ── Esquemas de salida ──
export const NotificationMixedItemSchema = z
  .union([
    NotificationSchema.extend({ type: z.literal('personal') }),
    GlobalNotificationSchema.extend({ type: z.literal('global') })
  ])
  .meta({ description: 'Ítem de la bandeja: `type` personal = notificación del usuario; global = aviso para todos.' });

export const UnreadCountSchema = z.object({ count: z.number().int().meta({ example: 3 }) });

// Resultado armado en el service (sin función DTO). `estadoSolicitud` es el contrato heredado con los servicios externos.
export const NotificationCreatedSchema = z.object({
  estadoSolicitud: z.literal(1),
  message: z.string(),
  notificationId: z.uuid().optional().meta({ description: 'Si la notificación fue para un usuario.' }),
  globalNotificationId: z.uuid().optional().meta({ description: 'Si fue global (sin userId).' })
});
export type NotificationCreated = z.infer<typeof NotificationCreatedSchema>;
