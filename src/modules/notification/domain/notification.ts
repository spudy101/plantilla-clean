// Notificaciones de la bandeja in-app: las personales (una fila por destinatario) y las globales (una sola fila
// que ven todos los clientes, con su propio registro de lecturas). La bandeja las mezcla por fecha.
import type { NotificationType } from './notification-type';

export interface RelatedEntity {
  type?: string | null;
  id?: string | null;
}

export interface PersonalNotification {
  notificationId: string;
  userId: string;
  notificationTypeId: string | null;
  title: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadata: unknown;
  isRead: boolean | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** null si la notificación no tiene tipo (o si la lectura no lo trajo). */
  notificationType: NotificationType | null;
}

export type GlobalNotificationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface GlobalNotification {
  globalNotificationId: string;
  notificationTypeId: string | null;
  title: string;
  body: string;
  metadata: unknown;
  sendPush: boolean;
  sendEmail: boolean;
  status: GlobalNotificationStatus;
  /** Último user_id al que llegó el envío masivo (desde ahí se retoma). */
  cursorUserId: string | null;
  lockedUntil: Date | null;
  createdAt: Date;
  notificationType: NotificationType | null;
}

/** Los datos de una notificación nueva (personal o global). */
export interface NewPersonalNotification {
  userId: string;
  notificationTypeId: string;
  title: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadata: Record<string, unknown>;
}

export interface NewGlobalNotification {
  notificationTypeId: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  sendPush: boolean;
  sendEmail: boolean;
  /** Si viene, la global nace reservada para enviarla ya (status processing hasta `lockedUntil`). */
  reservedUntil?: Date | null;
}

/** Las variables de una notificación (JSON libre); {} si no tiene. */
export const metadataOf = (notification: { metadata: unknown }): Record<string, unknown> =>
  (notification.metadata as Record<string, unknown> | null) ?? {};

// ── Bandeja mezclada ──────────────────────────────────────────

export type FeedItem =
  | { kind: 'personal'; notification: PersonalNotification; createdAt: Date; isRead: boolean | null }
  | { kind: 'global'; notification: GlobalNotification; createdAt: Date; isRead: boolean };

export type GlobalFeedItem = Extract<FeedItem, { kind: 'global' }>;

export const personalItem = (notification: PersonalNotification): FeedItem => ({
  kind: 'personal',
  notification,
  createdAt: notification.createdAt,
  isRead: notification.isRead
});

export const globalItem = (notification: GlobalNotification, readIds: readonly string[]): GlobalFeedItem => ({
  kind: 'global',
  notification,
  createdAt: notification.createdAt,
  isRead: readIds.includes(notification.globalNotificationId)
});

/** Mezcla personales y globales por fecha de creación (el único orden que admite la bandeja). */
export function mergeByCreatedAt(personal: readonly FeedItem[], global: readonly FeedItem[], order: string): FeedItem[] {
  const direction = order === 'DESC' ? -1 : 1;
  return [...personal, ...global].sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime()));
}

/** Lo que falta marcar como leído en una página de la bandeja: personales sin leer y globales que no leyó. */
export function unreadOnPage(items: readonly FeedItem[], readIds: readonly string[]) {
  return {
    personal: items.flatMap(item => (item.kind === 'personal' && !item.isRead ? [item.notification.notificationId] : [])),
    global: items.flatMap(item =>
      item.kind === 'global' && !readIds.includes(item.notification.globalNotificationId) ? [item.notification.globalNotificationId] : []
    )
  };
}
