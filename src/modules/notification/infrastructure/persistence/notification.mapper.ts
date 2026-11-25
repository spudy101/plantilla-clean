// Mappers fila de Prisma → entidades de notification. Es el único lugar que conoce las dos formas: si cambia el
// esquema de la base, cambia esto y no el dominio. Los campos de origen (origin_correlation_id) no salen de la
// infraestructura; el horario de silencio (TIME) sale como texto 'HH:MM:SS'.
import type {
  EmailBounceSuppression as EmailBounceSuppressionRow,
  GlobalNotification as GlobalNotificationRow,
  Notification as NotificationRow,
  NotificationCategory as NotificationCategoryRow,
  NotificationDelivery as NotificationDeliveryRow,
  NotificationType as NotificationTypeRow,
  UserNotificationPreference as PreferenceRow,
  VerificationCode as VerificationCodeRow
} from '../../../../shared/infrastructure/database/generated/prisma/client';
import { fromTime } from '../../../../shared/infrastructure/database/prisma-time';
import type { ClaimedDelivery, DeliveryRecord } from '../../domain/delivery';
import type { EmailSuppression } from '../../domain/email-suppression';
import type { GlobalNotification, PersonalNotification } from '../../domain/notification';
import type { NotificationPreference } from '../../domain/notification-preference';
import type { NotificationCategory, NotificationType } from '../../domain/notification-type';
import type { VerificationCode } from '../../domain/verification-code';

/** Un tipo como lo lee Prisma: con su categoría si la consulta la incluyó. */
export type TypeRow = NotificationTypeRow & { category?: NotificationCategoryRow | null };

export interface DeliveryRowWithNotification extends NotificationDeliveryRow {
  notification: Pick<
    NotificationRow,
    'notificationId' | 'userId' | 'title' | 'body' | 'metadata' | 'relatedEntityType' | 'relatedEntityId' | 'createdAt'
  > & {
    notificationType: { code: string; name: string; category: { code: string; name: string; isCritical: boolean } | null } | null;
  };
}

export const NotificationMapper = {
  categoryToDomain(row: NotificationCategoryRow): NotificationCategory {
    return {
      notificationCategoryId: row.notificationCategoryId,
      code: row.code,
      name: row.name,
      description: row.description,
      supportsPush: row.supportsPush,
      supportsEmail: row.supportsEmail,
      supportsSms: row.supportsSms,
      isCritical: row.isCritical,
      emailLayoutTemplate: row.emailLayoutTemplate,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  },

  typeToDomain(row: TypeRow): NotificationType {
    return {
      notificationTypeId: row.notificationTypeId,
      code: row.code,
      name: row.name,
      description: row.description,
      notificationCategoryId: row.notificationCategoryId,
      titleTemplate: row.titleTemplate,
      bodyTemplate: row.bodyTemplate,
      emailSubjectTemplate: row.emailSubjectTemplate,
      emailBodyTemplate: row.emailBodyTemplate,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      category: row.category ? NotificationMapper.categoryToDomain(row.category) : null
    };
  },

  notificationToDomain(row: NotificationRow & { notificationType?: TypeRow | null }): PersonalNotification {
    return {
      notificationId: row.notificationId,
      userId: row.userId,
      notificationTypeId: row.notificationTypeId,
      title: row.title,
      body: row.body,
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      metadata: row.metadata,
      isRead: row.isRead,
      readAt: row.readAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      notificationType: row.notificationType ? NotificationMapper.typeToDomain(row.notificationType) : null
    };
  },

  globalToDomain(row: GlobalNotificationRow & { notificationType?: TypeRow | null }): GlobalNotification {
    return {
      globalNotificationId: row.globalNotificationId,
      notificationTypeId: row.notificationTypeId,
      title: row.title,
      body: row.body,
      metadata: row.metadata,
      sendPush: row.sendPush,
      sendEmail: row.sendEmail,
      status: row.status,
      cursorUserId: row.cursorUserId,
      lockedUntil: row.lockedUntil,
      createdAt: row.createdAt,
      notificationType: row.notificationType ? NotificationMapper.typeToDomain(row.notificationType) : null
    };
  },

  claimedToDomain(row: Pick<NotificationDeliveryRow, 'notificationDeliveryId' | 'notificationId' | 'channel' | 'attempts'>): ClaimedDelivery {
    return { notificationDeliveryId: row.notificationDeliveryId, notificationId: row.notificationId, channel: row.channel, attempts: row.attempts };
  },

  deliveryToDomain(row: DeliveryRowWithNotification): DeliveryRecord {
    const { notification } = row;
    const type = notification.notificationType;
    return {
      notificationDeliveryId: row.notificationDeliveryId,
      notificationId: row.notificationId,
      channel: row.channel,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      sentAt: row.sentAt,
      lastError: row.lastError,
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      notification: {
        notificationId: notification.notificationId,
        userId: notification.userId,
        title: notification.title,
        body: notification.body,
        metadata: notification.metadata,
        relatedEntityType: notification.relatedEntityType,
        relatedEntityId: notification.relatedEntityId,
        createdAt: notification.createdAt,
        notificationType: type
          ? {
              code: type.code,
              name: type.name,
              category: type.category ? { code: type.category.code, name: type.category.name, isCritical: type.category.isCritical } : null
            }
          : null
      }
    };
  },

  preferenceToDomain(row: PreferenceRow): NotificationPreference {
    return {
      userNotificationPreferenceId: row.userNotificationPreferenceId,
      userId: row.userId,
      allowPush: row.allowPush,
      allowEmail: row.allowEmail,
      allowSms: row.allowSms,
      quietHoursStart: fromTime(row.quietHoursStart),
      quietHoursEnd: fromTime(row.quietHoursEnd),
      originSessionId: row.originSessionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  },

  verificationCodeToDomain(row: VerificationCodeRow): VerificationCode {
    return {
      verificationCodeId: row.verificationCodeId,
      type: row.type,
      contactValue: row.contactValue,
      code: row.code,
      attempts: row.attempts,
      expiresAt: row.expiresAt,
      verifiedAt: row.verifiedAt,
      originSessionId: row.originSessionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  },

  suppressionToDomain(row: EmailBounceSuppressionRow): EmailSuppression {
    return {
      emailBounceSuppressionId: row.emailBounceSuppressionId,
      emailHash: row.emailHash,
      userId: row.userId,
      bounceCount: row.bounceCount,
      status: row.status,
      lastErrorCode: row.lastErrorCode,
      lastBounceAt: row.lastBounceAt,
      suppressedAt: row.suppressedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
};
