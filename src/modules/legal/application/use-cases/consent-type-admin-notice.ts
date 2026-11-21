// Aviso al administrador que creó o editó un tipo de consentimiento. No bloquea la respuesta: si falla, solo
// se loguea.
import type { Notifier } from '../../../../shared/application/ports/notifier.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { ConsentType } from '../../domain/consent-type';

export const CONSENT_TYPE_ADMIN_NOTIFICATION = 'CONSENT_TYPE_ADMIN_ACTION';

export interface ConsentTypeNoticeDeps {
  notifier: Notifier;
  logger: Logger;
  /** Logo de las plantillas de correo (configuración del despliegue). */
  logoUrl: string | null | undefined;
}

export function noticeConsentTypeAdmin(
  { notifier, logger, logoUrl }: ConsentTypeNoticeDeps,
  accion: 'creado' | 'actualizado',
  type: Pick<ConsentType, 'consentTypeId' | 'code'>,
  actorId: string
): void {
  notifier
    .notify({
      type: CONSENT_TYPE_ADMIN_NOTIFICATION,
      userId: actorId,
      relatedEntity: { type: 'ConsentType', id: type.consentTypeId },
      metadata: { accion, code: type.code, logoUrl }
    })
    .catch((error: unknown) =>
      logger.warn('Error enviando notificación admin consent-type', {
        error: error instanceof Error ? error.message : String(error),
        accion
      })
    );
}
