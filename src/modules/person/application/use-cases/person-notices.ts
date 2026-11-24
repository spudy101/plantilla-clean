// Avisos de person (al titular, a la dirección de email, al administrador que actuó). Salen después de
// responder y no bloquean nada: si uno falla, se loguea y los demás siguen.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { EmailNotification, EmailNotifier, Notification, Notifier } from '../../../../shared/application/ports/notifier.port';

export interface NoticeDeps {
  notifier: Notifier & EmailNotifier;
  logger: Logger;
  /** Logo de las plantillas de correo (configuración del despliegue). */
  logoUrl: string | null | undefined;
}

/** Un aviso: a un usuario (notify) o a una dirección (notifyEmail), con el mensaje de log si falla. */
export type Notice = ({ to: 'user' } & Notification | { to: 'email' } & EmailNotification) & { failure: string };

/** Los manda en segundo plano, después de responder. */
export function sendLater({ notifier, logger }: NoticeDeps, notices: Notice[], logMeta: Record<string, unknown> = {}): void {
  setImmediate(() => {
    for (const { to, failure, ...notice } of notices) {
      const sent =
        to === 'user' ? notifier.notify({ relatedEntity: null, ...(notice as Notification) }) : notifier.notifyEmail(notice as EmailNotification);
      sent.catch((error: unknown) => logger.warn(failure, { error: error instanceof Error ? error.message : String(error), ...logMeta }));
    }
  });
}

/** El aviso al administrador de que ejecutó `accion` sobre la cuenta `userId`. */
export function adminActionNotice({ logoUrl }: NoticeDeps, ctx: AdminAuditContext, accion: string, userId: string): Notice {
  return {
    to: 'user',
    type: 'PERSON_ADMIN_ACTION',
    userId: ctx.adminUserId,
    metadata: { nombre: ctx.adminFirstName, accion, userId, logoUrl },
    failure: 'Error sending admin action notification'
  };
}
