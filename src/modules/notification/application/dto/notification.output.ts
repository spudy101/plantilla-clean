// Salidas del módulo: categorías, tipos, notificaciones personales y globales, y la bandeja. Las mismas formas
// en client y admin (el admin suma lo suyo en admin-notification.output.ts); cada una tiene su esquema Zod en
// presentation/http/responses.
import MaskingUtil from '../../../../shared/domain/pii/masking.util';
import { pageMetadata, type PageRequest } from '../../../../shared/application/pagination';
import type { NotificationCategory, NotificationType } from '../../domain/notification-type';
import type { FeedItem, GlobalFeedItem, GlobalNotification, PersonalNotification } from '../../domain/notification';
import type { NotificationPreference } from '../../domain/notification-preference';

/** includeLayout: incluye el layout del email (solo admin/edición). */
export function toCategoryOutput(category: NotificationCategory | null | undefined, includeLayout = false) {
  if (!category) {
    return null;
  }
  return {
    notificationCategoryId: category.notificationCategoryId,
    code: category.code,
    name: category.name,
    description: category.description || null,
    supportsPush: category.supportsPush,
    supportsEmail: category.supportsEmail,
    supportsSms: category.supportsSms,
    isCritical: category.isCritical,
    isActive: category.isActive,
    ...(includeLayout ? { emailLayoutTemplate: category.emailLayoutTemplate || null } : {})
  };
}

export function toTypeOutput(type: NotificationType | null | undefined) {
  if (!type) {
    return null;
  }
  return {
    notificationTypeId: type.notificationTypeId,
    code: type.code,
    name: type.name,
    description: type.description || null,
    notificationCategoryId: type.notificationCategoryId || null,
    isActive: type.isActive,
    ...(type.category ? { category: toCategoryOutput(type.category) } : {})
  };
}

export function toNotificationOutput(notification: PersonalNotification, { includeType = false } = {}) {
  return {
    notificationId: notification.notificationId,
    userId: notification.userId,
    notificationTypeId: notification.notificationTypeId || null,
    title: notification.title,
    body: notification.body,
    relatedEntityType: notification.relatedEntityType || null,
    relatedEntityId: notification.relatedEntityId || null,
    // [RF-USR-01] | CA-06 | metadata es JSON libre: redactor profundo por key.
    metadata: MaskingUtil.redactPayload(notification.metadata) || null,
    isRead: notification.isRead,
    readAt: notification.readAt || null,
    createdAt: notification.createdAt,
    ...(includeType && notification.notificationType ? { notificationType: toTypeOutput(notification.notificationType) } : {})
  };
}

/** isRead: si viene (true/false), si el usuario actual ya la leyó. */
export function toGlobalNotificationOutput(
  notification: GlobalNotification,
  { includeType = false, isRead = null }: { includeType?: boolean; isRead?: boolean | null } = {}
) {
  return {
    globalNotificationId: notification.globalNotificationId,
    notificationTypeId: notification.notificationTypeId || null,
    title: notification.title,
    body: notification.body,
    metadata: MaskingUtil.redactPayload(notification.metadata) || null,
    sendPush: notification.sendPush,
    sendEmail: notification.sendEmail,
    createdAt: notification.createdAt,
    ...(isRead !== null ? { isRead } : {}),
    ...(includeType && notification.notificationType ? { notificationType: toTypeOutput(notification.notificationType) } : {})
  };
}

function toFeedItemOutput(item: FeedItem, readIds: readonly string[]) {
  if (item.kind === 'personal') {
    return { type: 'personal', ...toNotificationOutput(item.notification, { includeType: true }) };
  }
  return {
    type: 'global',
    ...toGlobalNotificationOutput(item.notification, {
      includeType: true,
      isRead: readIds.includes(item.notification.globalNotificationId)
    })
  };
}

/** La bandeja mezclada (una página). */
export function toFeedOutput(items: readonly FeedItem[], readIds: readonly string[], page: PageRequest, totalItems: number) {
  return { data: items.map(item => toFeedItemOutput(item, readIds)), metadata: pageMetadata(page, totalItems) };
}

export function toPersonalListOutput(rows: readonly PersonalNotification[], page: PageRequest, count: number) {
  return { data: rows.map(n => toNotificationOutput(n, { includeType: true })), metadata: pageMetadata(page, count) };
}

export function toGlobalListOutput(rows: readonly GlobalFeedItem[], readIds: readonly string[], page: PageRequest, totalItems: number) {
  return {
    data: rows.map(item =>
      toGlobalNotificationOutput(item.notification, {
        includeType: true,
        isRead: readIds.includes(item.notification.globalNotificationId)
      })
    ),
    metadata: pageMetadata(page, totalItems)
  };
}

/**
 * La preferencia tal como la aplica el envío. Si nunca la configuró (`configured: false`), los valores por
 * defecto: todos los canales permitidos y sin horario de silencio.
 */
export function toPreferenceOutput(preference: NotificationPreference | null) {
  return {
    configured: preference !== null,
    allowPush: preference?.allowPush ?? true,
    allowEmail: preference?.allowEmail ?? true,
    allowSms: preference?.allowSms ?? true,
    quietHoursStart: preference?.quietHoursStart ?? null,
    quietHoursEnd: preference?.quietHoursEnd ?? null,
    updatedAt: preference?.updatedAt ?? null
  };
}

/** Lo que responde la creación de una notificación (contrato heredado con los servicios externos). */
export type NotificationCreated =
  | { estadoSolicitud: 1; message: string; notificationId: string }
  | { estadoSolicitud: 1; message: string; globalNotificationId: string };
