// modules/notification/notify.ts
//
// API pública para que otros módulos manden notificaciones. Lo de adentro (tipos, plantillas, canales,
// preferencias, reintentos, rate limit) es asunto de este módulo:
//
//   await notify({ type: 'PERSON_ROLE_CHANGED', userId, metadata: { nuevoRol: 'admin' } });
//   await notifyEmail({ type: 'ACCOUNT_DELETED', email, metadata: { nombre } });
import notificationCreationService from './services/notification-creation.service';
import type NotificationCreationService from './services/notification-creation.service';

type RelatedEntity = NonNullable<Parameters<(typeof NotificationCreationService)['crearNotificacion']>[0]['relatedEntity']>;

export interface NotifyInput {
  /** Código del tipo de notificación (notification_types.code); define plantillas y canales. */
  type: string;
  /** Destinatario; null o ausente → notificación global (a todos los usuarios). */
  userId?: string | null;
  /** Entidad a la que se refiere (para enlazarla desde la notificación). */
  relatedEntity?: RelatedEntity | null;
  /** Variables de las plantillas ({{variable}}). */
  metadata?: Record<string, unknown>;
}

export interface NotifyEmailInput {
  type: string;
  /** Correo destino, para quien no tiene (o ya no tiene) cuenta: p. ej. tras eliminarla. */
  email: string;
  metadata?: Record<string, unknown>;
}

/** Notifica a un usuario (o a todos) por los canales que defina su tipo y permitan sus preferencias. */
export function notify({ type, ...rest }: NotifyInput) {
  return notificationCreationService.crearNotificacion({ tipoNotificacion: type, ...rest });
}

/** Envía directo por correo, sin usuario ni preferencias. */
export function notifyEmail({ type, ...rest }: NotifyEmailInput) {
  return notificationCreationService.crearNotificacionDirecta({ tipoNotificacion: type, ...rest });
}

export default { notify, notifyEmail };
