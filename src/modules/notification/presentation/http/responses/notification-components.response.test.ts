// La salida de cada caso de uso de notificaciones cumple su esquema (y por lo tanto su documentación).
import {
  GlobalNotificationSchema,
  NotificationCategorySchema,
  NotificationSchema,
  NotificationTypeSchema
} from './notification-components.response';
import { NotificationCategoryAdminSchema } from './admin-notification-category.response';
import { NotificationDeliveryDetailSchema, NotificationDeliveryItemSchema } from './admin-notification-delivery.response';
import { DirectNotificationQueuedSchema, GlobalNotificationQueuedSchema, NotificationTypeAdminSchema } from './admin-notification-type.response';
import { NotificationPreferenceSchema } from './notification-preference.response';
import { NotificationMixedItemSchema, UnreadCountSchema } from './notification.response';
import { SendVerificationSchema, VerifyCodeSchema } from './send-verification.response';
import {
  toCategoryOutput,
  toFeedOutput,
  toGlobalNotificationOutput,
  toNotificationOutput,
  toPreferenceOutput,
  toTypeOutput
} from '../../../application/dto/notification.output';
import {
  toCategoryAdminOutput,
  toDeliveryDetailOutput,
  toDeliveryOutput,
  toDirectAnnouncementOutput,
  toGlobalAnnouncementOutput,
  toTypeAdminOutput,
  toVerificationSentOutput
} from '../../../application/dto/admin-notification.output';
import { globalItem, personalItem } from '../../../domain/notification';
import {
  AT,
  ID,
  category,
  deliveryRecord,
  globalNotification,
  notificationType,
  personalNotification,
  preference,
  verificationCode
} from '../../../../../../tests/doubles/notification.doubles';
import { page } from '../../../../../../tests/helpers/page';

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de notificaciones', () => {
  it('bloques: categoría, tipo, notificación y global', () => {
    ok(NotificationCategorySchema, toCategoryOutput(category()));
    ok(NotificationTypeSchema, toTypeOutput(notificationType()));
    ok(NotificationSchema, toNotificationOutput(personalNotification({ metadata: { email: 'ana@correo.co' } }), { includeType: true }));
    ok(GlobalNotificationSchema, toGlobalNotificationOutput(globalNotification({ metadata: null }), { includeType: true, isRead: true }));
  });

  it('admin: categoría, tipo y envíos encolados', () => {
    ok(NotificationCategoryAdminSchema, toCategoryAdminOutput(category()));
    ok(NotificationTypeAdminSchema, toTypeAdminOutput(notificationType({ emailSubjectTemplate: null, emailBodyTemplate: null })));
    ok(GlobalNotificationQueuedSchema, toGlobalAnnouncementOutput({ globalNotificationId: ID, titulo: 't', contenido: 'c', asunto: null }));
    ok(DirectNotificationQueuedSchema, toDirectAnnouncementOutput({ notificationId: ID, userId: ID, titulo: 't', contenido: 'c' }));
  });

  it('admin: entregas (ítem y detalle)', () => {
    ok(NotificationDeliveryItemSchema, toDeliveryOutput(deliveryRecord()));
    const record = deliveryRecord();
    ok(NotificationDeliveryDetailSchema, toDeliveryDetailOutput({ ...record, notification: { ...record.notification, notificationType: null } }));
  });

  it('cliente: bandeja, conteo, preferencia y verificación', () => {
    const feed = toFeedOutput([personalItem(personalNotification()), globalItem(globalNotification({ metadata: null }), [ID])], [ID], page(), 2);
    feed.data.forEach(item => ok(NotificationMixedItemSchema, item));
    ok(UnreadCountSchema, { count: 3 });
    ok(NotificationPreferenceSchema, toPreferenceOutput(null));
    ok(NotificationPreferenceSchema, toPreferenceOutput(preference({ allowPush: false, allowSms: null, quietHoursStart: '22:00:00', quietHoursEnd: '07:00:00' })));
    ok(SendVerificationSchema, toVerificationSentOutput(verificationCode({ expiresAt: AT }), '****12'));
    ok(VerifyCodeSchema, { verified: true });
  });
});
