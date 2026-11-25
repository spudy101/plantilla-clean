// Adaptador: los puertos Notifier y EmailNotifier (shared/application) implementados con el módulo notification.
//
// Los módulos se arman antes que notification (iam, audit) o sin depender del orden: el aviso busca el notifier de
// notification al usarse.
import type { EmailNotifier, Notifier } from '../../shared/application/ports/notifier.port';
import type { ModuleRegistry } from './module-registry';

export function notifierAdapter(modules: ModuleRegistry): Notifier & EmailNotifier {
  return {
    notify: notification => modules.notification.notifier.notify(notification),
    notifyEmail: notification => modules.notification.notifier.notifyEmail(notification)
  };
}
