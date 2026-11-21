import type SnsSignature from '../../../shared/infrastructure/security/sns-signature.util';
// Ingesta REAL del feed asíncrono de bounces de SES vía SNS. SES publica los rebotes
// (Configuration Set → topic SNS); SNS hace POST a este webhook. Se verifica la firma del mensaje SNS
// (obligatoria: un POST forjado suprimiría el correo de una víctima), se confirma la suscripción al
// conectarse, y por cada rebote PERMANENTE se registra hacia el umbral de supresión. Los rebotes
// transitorios (soft) y las quejas (complaint) se ignoran acá.

import emailSuppressionService from './email-suppression.service';
import snsSignatureUtilModule from '../../../shared/infrastructure/security/sns-signature.util';
const { verifySnsSignature, confirmSnsSubscription } = snsSignatureUtilModule;
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import auditModule from '../../audit';
const { audit } = auditModule;

const ENTITY = { entityType: 'EmailBounceSuppression', entityTable: 'email_bounce_suppressions' };

class EmailBounceWebhookService {
  emailSuppressionService: typeof emailSuppressionService;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new EmailBounceWebhookService({ emailSuppressionService: fake })
   * @param {object} [deps]
   */
  constructor(deps: EmailBounceWebhookService.Deps = {}) {
    this.emailSuppressionService = deps.emailSuppressionService ?? emailSuppressionService;
  }

  /**
   * Procesa el cuerpo crudo (string) de un POST de SNS.
   * @param {string|Object} rawBody
   */
  async process(rawBody: string | Record<string, unknown> | null | undefined) {
    const message = this._parse(rawBody);

    const validSignature = await verifySnsSignature(message);
    if (!validSignature) {
      throw AppError.unauthorized('Firma SNS inválida');
    }

    const expectedTopic = notifications.sns.bounceTopicArn;
    if (expectedTopic && message.TopicArn !== expectedTopic) {
      throw AppError.unauthorized('TopicArn no autorizado');
    }

    if (message.Type === 'SubscriptionConfirmation' || message.Type === 'UnsubscribeConfirmation') {
      await confirmSnsSubscription(message);
      await audit.record('EMAIL_BOUNCE_SUBSCRIPTION_CONFIRMED', {
        actorId: 'system',
        details: { topicArn: message.TopicArn },
        ...ENTITY
      });
      return { type: message.Type, confirmed: true, processed: 0, suppressed: 0 };
    }

    if (message.Type !== 'Notification') {
      return { type: message.Type || 'unknown', processed: 0, suppressed: 0 };
    }

    return this._handleNotification(message);
  }

  /** @private — parsea el envelope SNS (string text/plain → objeto). */
  _parse(rawBody: string | Record<string, unknown> | null | undefined): SnsSignature.Message {
    // La firma se verifica después: hasta entonces la forma es la que dice el propio mensaje
    if (rawBody && typeof rawBody === 'object') {
      return rawBody as SnsSignature.Message;
    }
    try {
      return JSON.parse(rawBody ?? '') as SnsSignature.Message;
    } catch {
      throw AppError.badRequest('Cuerpo del webhook no es JSON válido');
    }
  }

  /** @private — procesa una Notification: solo rebotes permanentes suman al umbral. */
  async _handleNotification(message: SnsSignature.Message) {
    let ses;
    try {
      ses = JSON.parse(message.Message ?? '');
    } catch {
      throw AppError.badRequest('El campo Message de SNS no es JSON válido');
    }

    // Formato de feedback forwarding usa notificationType; el de event publishing usa eventType.
    const kind = ses.notificationType || ses.eventType;
    const { bounce } = ses;

    if (kind !== 'Bounce' || !bounce || bounce.bounceType !== 'Permanent') {
      logger.info('[EmailBounceWebhook] Evento ignorado (no es rebote permanente)', {
        kind,
        bounceType: bounce?.bounceType || null
      });
      return { type: 'Notification', processed: 0, suppressed: 0 };
    }

    const recipients = Array.isArray(bounce.bouncedRecipients) ? bounce.bouncedRecipients : [];
    const errorCode = bounce.bounceSubType || 'Permanent';
    let suppressed = 0;

    for (const recipient of recipients) {
      if (!recipient?.emailAddress) {
        continue;
      }
      const result = await this.emailSuppressionService.registerHardBounce({
        email: recipient.emailAddress,
        errorCode
      });
      if (result?.suppressed) {
        suppressed++;
      }
    }

    await audit.record('EMAIL_BOUNCE_WEBHOOK_RECEIVED', {
      actorId: 'system',
      details: { recipients: recipients.length, suppressed, bounceSubType: errorCode, feedbackId: bounce.feedbackId || null },
      ...ENTITY,
      outcome: 'failure'
    });

    return { type: 'Notification', processed: recipients.length, suppressed };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace EmailBounceWebhookService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    emailSuppressionService?: typeof emailSuppressionService;
  }
}

export default Object.assign(new EmailBounceWebhookService(), { EmailBounceWebhookService });
