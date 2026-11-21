// API pública del módulo notification: lo ÚNICO que otros módulos (y src/app.ts) pueden importar.
// Lo que no está acá es interno del módulo (docs/ARCHITECTURE.md, regla 2).
//
// Cada export se carga al usarse (getter): los módulos se usan entre sí y un index que cargara todo
// de una vez crearía ciclos de carga. Uso: import notificationModule from '…/notification'; const { X } = notificationModule;
import { interopDefault } from '../../shared/utils/interop.util';

export default {
  get notificationComponentsDto() {
    return interopDefault(require('./responses/notification-components.response') as typeof import('./responses/notification-components.response'));
  },

  get emailBounceSuppressionRepository() {
    return interopDefault(require('./repositories/email-bounce-suppression.repository') as typeof import('./repositories/email-bounce-suppression.repository'));
  },

  get globalNotificationReadRepository() {
    return interopDefault(require('./repositories/global-notification-read.repository') as typeof import('./repositories/global-notification-read.repository'));
  },

  get globalNotificationRepository() {
    return interopDefault(require('./repositories/global-notification.repository') as typeof import('./repositories/global-notification.repository'));
  },

  get notificationCategoryRepository() {
    return interopDefault(require('./repositories/notification-category.repository') as typeof import('./repositories/notification-category.repository'));
  },

  get notificationTypeRepository() {
    return interopDefault(require('./repositories/notification-type.repository') as typeof import('./repositories/notification-type.repository'));
  },

  get notificationRepository() {
    return interopDefault(require('./repositories/notification.repository') as typeof import('./repositories/notification.repository'));
  },

  get smsDeliveryAttemptRepository() {
    return interopDefault(require('./repositories/sms-delivery-attempt.repository') as typeof import('./repositories/sms-delivery-attempt.repository'));
  },

  get notificationPreferenceRepository() {
    return interopDefault(require('./repositories/user-notification-preference.repository') as typeof import('./repositories/user-notification-preference.repository'));
  },

  get userPushTokenRepository() {
    return interopDefault(require('./repositories/user-push-token.repository') as typeof import('./repositories/user-push-token.repository'));
  },

  get verificationCodeRepository() {
    return interopDefault(require('./repositories/verification-code.repository') as typeof import('./repositories/verification-code.repository'));
  },

  get adminNotificationCategoryRoutes() {
    return interopDefault(require('./routes/admin-notification-category.routes') as typeof import('./routes/admin-notification-category.routes'));
  },

  get adminNotificationDeliveryRoutes() {
    return interopDefault(require('./routes/admin-notification-delivery.routes') as typeof import('./routes/admin-notification-delivery.routes'));
  },

  get adminNotificationTypeRoutes() {
    return interopDefault(require('./routes/admin-notification-type.routes') as typeof import('./routes/admin-notification-type.routes'));
  },

  get emailBounceWebhookRoutes() {
    return interopDefault(require('./routes/email-bounce-webhook.routes') as typeof import('./routes/email-bounce-webhook.routes'));
  },

  get notificationPreferenceRoutes() {
    return interopDefault(require('./routes/notification-preference.routes') as typeof import('./routes/notification-preference.routes'));
  },

  get notificationRoutes() {
    return interopDefault(require('./routes/notification.routes') as typeof import('./routes/notification.routes'));
  },

  get sendVerificationRoutes() {
    return interopDefault(require('./routes/send-verification.routes') as typeof import('./routes/send-verification.routes'));
  },

  /** Mandar notificaciones: notifier.notify({ type, userId, metadata }) / notifier.notifyEmail({ type, email }). */
  get notifier() {
    return interopDefault(require('./notify') as typeof import('./notify'));
  },

  get SmsService() {
    return interopDefault(require('./services/sms.service') as typeof import('./services/sms.service'));
  },

  get NotificationEmitter() {
    return interopDefault(require('./utils/notification-emitter.util') as typeof import('./utils/notification-emitter.util'));
  },

  get NotificationWorker() {
    return interopDefault(require('./workers/notification-worker') as typeof import('./workers/notification-worker'));
  },

  get pushNotificationService() {
    return interopDefault(require('./services/push-notification.service') as typeof import('./services/push-notification.service'));
  }
};
