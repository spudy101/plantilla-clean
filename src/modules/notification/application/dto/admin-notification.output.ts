// Salidas del panel admin: categorías (con el layout del email), tipos (con sus plantillas), entregas y la
// confirmación de los avisos enviados desde el panel.
import MaskingUtil from '../../../../shared/domain/pii/masking.util';
import type { DeliveryRecord } from '../../domain/delivery';
import type { NotificationCategory, NotificationType } from '../../domain/notification-type';
import type { VerificationCode } from '../../domain/verification-code';
import { toCategoryOutput, toTypeOutput } from './notification.output';

export function toCategoryAdminOutput(category: NotificationCategory) {
  return { ...toCategoryOutput(category, true), updatedAt: category.updatedAt };
}

/** El admin ve las plantillas completas: campos que el cliente nunca ve. */
export function toTypeAdminOutput(type: NotificationType) {
  return {
    ...toTypeOutput(type),
    titleTemplate: type.titleTemplate,
    bodyTemplate: type.bodyTemplate,
    emailSubjectTemplate: type.emailSubjectTemplate,
    emailBodyTemplate: type.emailBodyTemplate,
    isActive: type.isActive,
    updatedAt: type.updatedAt
  };
}

interface Announcement {
  titulo: string;
  contenido: string;
  asunto?: string | null;
}

/** El aviso a todos quedó encolado (el envío masivo sigue en segundo plano). */
export const toGlobalAnnouncementOutput = ({ globalNotificationId, titulo, contenido, asunto }: Announcement & { globalNotificationId: string }) => ({
  globalNotificationId,
  titulo,
  contenido,
  asunto,
  processingStatus: 'queued',
  createdAt: new Date()
});

export const toDirectAnnouncementOutput = ({
  notificationId,
  userId,
  titulo,
  contenido,
  asunto
}: Announcement & { notificationId: string; userId: string }) => ({
  notificationId,
  userId,
  titulo,
  contenido,
  asunto,
  processingStatus: 'queued',
  createdAt: new Date()
});

/** Una entrega con lo justo de su notificación para que soporte responda "¿le llegó?". */
export function toDeliveryOutput(record: DeliveryRecord) {
  const { notification } = record;
  const type = notification.notificationType;
  return {
    notificationDeliveryId: record.notificationDeliveryId,
    notificationId: record.notificationId,
    userId: notification.userId,
    title: notification.title,
    channel: record.channel,
    status: record.status,
    attempts: record.attempts,
    nextAttemptAt: record.nextAttemptAt,
    sentAt: record.sentAt,
    lastError: record.lastError,
    lastErrorCode: record.lastErrorCode,
    notificationType: type
      ? {
          code: type.code,
          name: type.name,
          category: type.category ? { code: type.category.code, name: type.category.name, isCritical: type.category.isCritical } : null
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function toDeliveryDetailOutput(record: DeliveryRecord) {
  const { notification } = record;
  return {
    ...toDeliveryOutput(record),
    body: notification.body,
    // [RF-USR-01] | CA-06 | El metadata lleva el correo real del titular → redactor profundo por key.
    metadata: MaskingUtil.redactPayload(notification.metadata) || null,
    relatedEntityType: notification.relatedEntityType,
    relatedEntityId: notification.relatedEntityId,
    notificationCreatedAt: notification.createdAt
  };
}

/** El código enviado: su id y vencimiento, y el código parcial solo donde corresponde (pruebas o SMS). */
export function toVerificationSentOutput(verificationCode: Pick<VerificationCode, 'verificationCodeId' | 'expiresAt'>, truncatedCode: string | null) {
  return {
    verificationCodeId: verificationCode.verificationCodeId,
    expiresAt: verificationCode.expiresAt,
    ...(truncatedCode ? { truncatedCode } : {})
  };
}

/** Lo que el webhook de rebotes le responde a SNS (no expone datos del rebote). */
export interface BounceFeedResult {
  type?: string;
  confirmed?: boolean;
  processed?: number;
  suppressed?: number;
}

export const toBounceFeedAck = (result: BounceFeedResult) => ({
  type: result.type,
  confirmed: result.confirmed ?? false,
  processed: result.processed ?? 0,
  suppressed: result.suppressed ?? 0
});
