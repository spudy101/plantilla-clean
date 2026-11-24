// Adaptador: los puertos Notifier y EmailNotifier (shared/application) implementados con el módulo notification.
import notificationModule from '../../modules/notification';
import type { EmailNotifier, Notifier } from '../../shared/application/ports/notifier.port';

export const notifierAdapter: Notifier & EmailNotifier = {
  notify: async notification => {
    await notificationModule.notifier.notify(notification);
  },
  notifyEmail: async notification => {
    await notificationModule.notifier.notifyEmail(notification);
  }
};
