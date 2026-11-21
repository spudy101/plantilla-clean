// Adaptador: el puerto Notifier (shared/application) implementado con el módulo notification.
import notificationModule from '../../modules/notification';
import type { Notifier } from '../../shared/application/ports/notifier.port';

export const notifierAdapter: Notifier = {
  notify: async notification => {
    await notificationModule.notifier.notify(notification);
  }
};
