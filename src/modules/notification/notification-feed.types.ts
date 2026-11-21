// modules/shared-endpoints/notification/notification-feed.types.ts
//
// Feed de notificaciones del usuario: personales + globales mezcladas y ordenadas por fecha.
// Lo arma NotificationService y lo serializan los DTOs. Solo tipos.
import type { GlobalNotification, Notification, NotificationType } from '../../shared/infrastructure/database/generated/prisma/client';
import type { PageRequest } from '../../shared/application/pagination';

export type PaginationParams = PageRequest;

/** Notificación personal o global con su tipo (filas de Prisma). */
export type PersonalRow = Notification & { notificationType: NotificationType | null };
export type GlobalRow = GlobalNotification & { notificationType: NotificationType | null };

/** Ítem del feed: unión discriminada por __type. */
export type FeedItem =
  | { __type: 'personal'; __instance: PersonalRow; createdAt: Date; isRead: boolean | null }
  | { __type: 'global'; __instance: GlobalRow; createdAt: Date; isRead: boolean };

export type GlobalFeedItem = Extract<FeedItem, { __type: 'global' }>;

export interface MixedListResult {
  mixed: FeedItem[];
  readIds: string[];
  totalItems: number;
  paginationParams: PaginationParams;
}

export interface PersonalListResult {
  rows: PersonalRow[];
  count: number;
  paginationParams: PaginationParams;
}

export interface GlobalListResult {
  rows: GlobalFeedItem[];
  readIds: string[];
  totalItems: number;
  paginationParams: PaginationParams;
}
