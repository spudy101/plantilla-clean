// Bloques reutilizables del módulo de notificaciones (client y admin): nunca duplicarlos.
// Cada constructor tiene su esquema Zod de salida al final del archivo (tipa y documenta la respuesta).

import MaskingUtil from '../../../shared/infrastructure/security/masking.util';
import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import type { DbDate, Maybe } from '../../../shared/infrastructure/database/db-rows';

interface NotificationCategoryRow {
  notificationCategoryId: string;
  code: string;
  name?: Maybe<string>;
  description?: Maybe<string>;
  supportsPush?: Maybe<boolean>;
  supportsEmail?: Maybe<boolean>;
  supportsSms?: Maybe<boolean>;
  isCritical?: Maybe<boolean>;
  isActive?: Maybe<boolean>;
  emailLayoutTemplate?: Maybe<string>;
}

interface NotificationTypeRow {
  notificationTypeId: string;
  code: string;
  name?: Maybe<string>;
  description?: Maybe<string>;
  notificationCategoryId?: Maybe<string>;
  isActive?: Maybe<boolean>;
  category?: Maybe<NotificationCategoryRow>;
}

interface NotificationRow {
  notificationId: string;
  userId: string;
  notificationTypeId?: Maybe<string>;
  title?: Maybe<string>;
  body?: Maybe<string>;
  relatedEntityType?: Maybe<string>;
  relatedEntityId?: Maybe<string>;
  metadata?: unknown;
  isRead?: Maybe<boolean>;
  readAt?: Maybe<DbDate>;
  createdAt?: Maybe<DbDate>;
  notificationType?: Maybe<NotificationTypeRow>;
}

interface GlobalNotificationRow {
  globalNotificationId: string;
  notificationTypeId?: Maybe<string>;
  title?: Maybe<string>;
  body?: Maybe<string>;
  metadata?: unknown;
  sendPush?: Maybe<boolean>;
  sendEmail?: Maybe<boolean>;
  createdAt?: Maybe<DbDate>;
  notificationType?: Maybe<NotificationTypeRow>;
}

interface NotificationBuildOptions {
  includeType?: boolean;
}

interface GlobalNotificationBuildOptions {
  includeType?: boolean;
  /** Si viene (true/false), se marca si el usuario actual ya la leyó. */
  isRead?: boolean | null;
}

// ============================================================
// NOTIFICATION CATEGORY
// ============================================================

class NotificationCategoryComponent {
  /** includeLayout: incluye email_layout_template (solo admin/edición). */
  static build(category: Maybe<NotificationCategoryRow>, includeLayout = false) {
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

  static buildArray(categories: Maybe<NotificationCategoryRow[]>, includeLayout = false) {
    if (!categories || categories.length === 0) {
      return [];
    }
    return categories.map(c => NotificationCategoryComponent.build(c, includeLayout));
  }
}

// ============================================================
// NOTIFICATION TYPE
// ============================================================

class NotificationTypeComponent {
  static build(notificationType: Maybe<NotificationTypeRow>) {
    if (!notificationType) {
      return null;
    }
    return {
      notificationTypeId: notificationType.notificationTypeId,
      code: notificationType.code,
      name: notificationType.name,
      description: notificationType.description || null,
      notificationCategoryId: notificationType.notificationCategoryId || null,
      isActive: notificationType.isActive,
      ...(notificationType.category ? { category: NotificationCategoryComponent.build(notificationType.category) } : {})
    };
  }
}

// ============================================================
// NOTIFICATION (personal)
// ============================================================

class NotificationComponent {
  static build(notification: Maybe<NotificationRow>, { includeType = false }: NotificationBuildOptions = {}) {
    if (!notification) {
      return null;
    }
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
      ...(includeType && notification.notificationType
        ? { notificationType: NotificationTypeComponent.build(notification.notificationType) }
        : {})
    };
  }

  static buildArray(notifications: Maybe<NotificationRow[]>, options: NotificationBuildOptions = {}) {
    if (!notifications || notifications.length === 0) {
      return [];
    }
    return notifications.map(n => NotificationComponent.build(n, options));
  }
}

// ============================================================
// GLOBAL NOTIFICATION
// ============================================================

class GlobalNotificationComponent {
  static build(
    globalNotification: Maybe<GlobalNotificationRow>,
    { includeType = false, isRead = null }: GlobalNotificationBuildOptions = {}
  ) {
    if (!globalNotification) {
      return null;
    }
    return {
      globalNotificationId: globalNotification.globalNotificationId,
      notificationTypeId: globalNotification.notificationTypeId || null,
      title: globalNotification.title,
      body: globalNotification.body,
      metadata: MaskingUtil.redactPayload(globalNotification.metadata) || null,
      sendPush: globalNotification.sendPush,
      sendEmail: globalNotification.sendEmail,
      createdAt: globalNotification.createdAt,
      ...(isRead !== null ? { isRead } : {}),
      ...(includeType && globalNotification.notificationType
        ? { notificationType: NotificationTypeComponent.build(globalNotification.notificationType) }
        : {})
    };
  }
}

// ============================================================
// ESQUEMAS DE SALIDA
// ============================================================

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

export default {
  NotificationCategoryComponent,
  NotificationTypeComponent,
  NotificationComponent,
  GlobalNotificationComponent
};
