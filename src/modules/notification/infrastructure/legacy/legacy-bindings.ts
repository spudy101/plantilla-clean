// @deprecated TRANSITORIO: los casos de uso de notification que iam y approvals (todavía sin migrar) usan por el
// index.ts: mandar notificaciones y SMS.
//
// Necesitan adaptadores de otros módulos (los destinatarios de iam, los prefijos de catalogs, la auditoría), que
// solo existen en el composition root. notification.module.ts los deja acá al armarse; el index los busca al
// usarse. Cuando esos módulos se migren, recibirán el puerto Notifier por el container y esto se borra.
import type { CreateNotification, SendDirectEmail } from '../../application/use-cases/create-notification.use-case';
import type { SmsSender } from '../../application/use-cases/sms-sender';

export interface LegacyBindings {
  createNotification: CreateNotification;
  sendDirectEmail: SendDirectEmail;
  sms: SmsSender;
}

let bindings: LegacyBindings | null = null;

export function bindLegacyNotification(next: LegacyBindings): void {
  bindings = next;
}

export function legacyBindings(): LegacyBindings {
  if (!bindings) {
    throw new Error('El módulo notification no está armado: src/main/container.ts (createContainer) todavía no corrió');
  }
  return bindings;
}
