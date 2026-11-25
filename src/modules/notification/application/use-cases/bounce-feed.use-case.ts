// La ingesta del feed asíncrono de rebotes de SES (vía SNS). Se verifica la firma del mensaje (obligatoria: un
// POST forjado suprimiría el correo de una víctima) y el topic, se confirma la suscripción al conectarse, y cada
// rebote PERMANENTE suma hacia el umbral de supresión.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import { isSubscriptionHandshake, parseFeedEnvelope, readFeedEvent } from '../../domain/bounce-feed';
import { InvalidFeedSignatureError, UnauthorizedTopicError } from '../../domain/errors';
import { toBounceFeedAck, type BounceFeedResult } from '../dto/admin-notification.output';
import type { BounceFeedVerifier } from '../ports/runtime.port';
import { SUPPRESSION_ENTITY, type EmailSuppressionList } from './email-suppression.use-cases';

export class ProcessBounceFeed {
  constructor(
    private readonly verifier: BounceFeedVerifier,
    private readonly suppressionList: Pick<EmailSuppressionList, 'registerHardBounce'>,
    private readonly audit: AuditTrail,
    private readonly logger: Logger,
    /** El topic del que se aceptan mensajes; sin configurar, cualquiera (con firma válida). */
    private readonly expectedTopicArn: string | null | undefined
  ) {}

  /** @param rawBody el cuerpo crudo del POST de SNS (texto). */
  async execute(rawBody: string | Record<string, unknown> | null | undefined) {
    return toBounceFeedAck(await this.process(rawBody));
  }

  private async process(rawBody: string | Record<string, unknown> | null | undefined): Promise<BounceFeedResult> {
    const message = parseFeedEnvelope(rawBody);
    if (!(await this.verifier.verify(message))) {
      throw new InvalidFeedSignatureError();
    }
    if (this.expectedTopicArn && message.TopicArn !== this.expectedTopicArn) {
      throw new UnauthorizedTopicError();
    }

    if (isSubscriptionHandshake(message)) {
      await this.verifier.confirmSubscription(message);
      await this.audit.record('EMAIL_BOUNCE_SUBSCRIPTION_CONFIRMED', {
        actorId: 'system',
        details: { topicArn: message.TopicArn },
        ...SUPPRESSION_ENTITY
      });
      return { type: message.Type, confirmed: true, processed: 0, suppressed: 0 };
    }
    if (message.Type !== 'Notification') {
      return { type: message.Type || 'unknown', processed: 0, suppressed: 0 };
    }

    const event = readFeedEvent(message);
    if (event.kind === 'ignored') {
      this.logger.info('[EmailBounceWebhook] Evento ignorado (no es rebote permanente)', { kind: event.eventKind, bounceType: event.bounceType });
      return { type: 'Notification', processed: 0, suppressed: 0 };
    }

    let suppressed = 0;
    for (const email of event.recipients) {
      const result = await this.suppressionList.registerHardBounce({ email, errorCode: event.errorCode });
      if (result?.suppressed) {
        suppressed++;
      }
    }
    await this.audit.record('EMAIL_BOUNCE_WEBHOOK_RECEIVED', {
      actorId: 'system',
      details: { recipients: event.recipientCount, suppressed, bounceSubType: event.errorCode, feedbackId: event.feedbackId },
      ...SUPPRESSION_ENTITY,
      outcome: 'failure'
    });
    return { type: 'Notification', processed: event.recipientCount, suppressed };
  }
}
