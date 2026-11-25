// @deprecated TRANSITORIO: mandar notificaciones desde iam y approvals (por el index.ts), con los casos de uso que
// dejó armados notification.module.ts. Lo de adentro (tipos, plantillas, canales, preferencias, reintentos) es
// asunto de notification:
//
//   await notify({ type: 'PERSON_ROLE_CHANGED', userId, metadata: { nuevoRol: 'admin' } });
//   await notifyEmail({ type: 'ACCOUNT_DELETED', email, metadata: { nombre } });
import type { RelatedEntity } from '../../domain/notification';
import { legacyBindings } from './legacy-bindings';

export interface NotifyInput {
  /** Código del tipo de notificación; define plantillas y canales. */
  type: string;
  /** Destinatario; null o ausente → notificación global (a todos los usuarios). */
  userId?: string | null;
  relatedEntity?: RelatedEntity | null;
  /** Variables de las plantillas ({{variable}}). */
  metadata?: Record<string, unknown>;
}

export interface NotifyEmailInput {
  type: string;
  /** Correo destino, para quien no tiene (o ya no tiene) cuenta. */
  email: string;
  metadata?: Record<string, unknown>;
}

/** Notifica a un usuario (o a todos) por los canales que defina su tipo y permitan sus preferencias. */
export function notify(input: NotifyInput) {
  return legacyBindings().createNotification.execute(input);
}

/** Envía directo por correo, sin usuario ni preferencias. */
export function notifyEmail(input: NotifyEmailInput) {
  return legacyBindings().sendDirectEmail.execute(input);
}

export default { notify, notifyEmail };
