// El email de un tipo de notificación: lo compone el dominio (plantillas + layout de la categoría), se omite si
// la dirección está suprimida por rebotes duros (se audita) y lo envía el proveedor.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import MaskingUtil from '../../../../shared/domain/pii/masking.util';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import { composeEmail, type EmailTemplateSource } from '../../domain/email-message';
import type { EmailGateway } from '../ports/channel-gateways.port';
import { SUPPRESSION_ENTITY, type EmailSuppressionList } from './email-suppression.use-cases';

const { errorMessage } = errorMessageModule;

export class SendTemplatedEmail {
  constructor(
    private readonly gateway: EmailGateway,
    private readonly suppressionList: Pick<EmailSuppressionList, 'isSuppressed'>,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  /**
   * @returns lo que respondió el proveedor; null si no se envió (la categoría no admite email, el tipo no tiene
   *   plantillas de email o la dirección está suprimida). Un fallo del proveedor se lanza.
   */
  async execute(
    to: string,
    type: EmailTemplateSource,
    data: Record<string, unknown>,
    notificationId: string | null = null
  ): Promise<{ messageId?: string | undefined } | null> {
    try {
      const email = composeEmail(type, data);
      if (email.status === 'unsupported') {
        this.logger.warn(
          email.reason === 'channel'
            ? 'La categoría de la notificación no soporta email'
            : 'El tipo de notificación no tiene templates de email configurados',
          { notificationType: type.code }
        );
        return null;
      }

      // Suppression list: no es un error de envío, se omite y se audita (protege la reputación de envío).
      if (await this.suppressionList.isSuppressed(to)) {
        this.logger.warn('[EmailNotification] Envío omitido: dirección suprimida por rebotes duros', {
          destinatario: MaskingUtil.maskEmail(to)
        });
        await this.audit.record('EMAIL_SUPPRESSED_SEND_SKIPPED', {
          actorId: 'system',
          details: { maskedEmail: MaskingUtil.maskEmail(to), notificationId },
          ...SUPPRESSION_ENTITY
        });
        return null;
      }

      // Los adjuntos (p. ej. un PDF de comprobante) son del envío, no del tipo: viajan en metadata.attachments.
      return await this.gateway.send({ to, subject: email.subject, html: email.html, attachments: data?.attachments, notificationId });
    } catch (error) {
      this.logger.warn('Error al enviar notificación por email', { error: errorMessage(error), destinatario: to, notificationType: type.code });
      throw error;
    }
  }
}
