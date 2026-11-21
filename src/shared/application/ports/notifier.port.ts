// Puerto de notificaciones: avisar a un usuario (o a todos) de que algo pasó.
//
// Lo implementa el módulo notification; src/main/ los conecta (adapters/notifier.adapter.ts). Qué
// canales se usan (email, push, SMS, in-app) lo decide el tipo de notificación, no quien avisa.

export interface Notification {
  /** Código del tipo de notificación (define plantillas y canales). */
  type: string;
  /** Destinatario; null → notificación global (a todos los usuarios). */
  userId: string | null;
  /** Entidad a la que se refiere, para enlazarla desde la notificación. */
  relatedEntity?: { type: string; id: string } | null;
  /** Variables de las plantillas. */
  metadata?: Record<string, unknown>;
}

export interface Notifier {
  notify(notification: Notification): Promise<void>;
}
