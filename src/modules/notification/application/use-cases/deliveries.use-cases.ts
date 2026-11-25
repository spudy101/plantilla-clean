// Envío de las notificaciones personales por canal externo (push / email / sms).
//
//   ScheduleDeliveries     → al crear la notificación (en su misma transacción): crea una entrega por canal.
//   DeliveryAttempts       → un intento: enviado / sin destinatario / error. Un error se reintenta con espera
//                            creciente; un rebote definitivo o el último intento la cierran como fallida (y se audita).
//   DispatchDueDeliveries  → el ciclo del despachador (cada minuto): toma las vencidas (diferidas, reintentos, o
//                            las que quedaron a medias porque el proceso murió) y las intenta.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import concurrencyUtilModule from '../../../../shared/kernel/concurrency.util';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import {
  DELIVERY_LEASE_MS,
  FAILED_DELIVERY_AUDIT_ACTION,
  SMS_MAX_LENGTH,
  groupByNotification,
  nextAttemptAfterFailure,
  planDeliveries,
  type ClaimedDelivery,
  type DeliveryOutcome
} from '../../domain/delivery';
import { metadataOf, type PersonalNotification } from '../../domain/notification';
import type { DeliveryPreference } from '../../domain/notification-preference';
import type { CategoryRules, Channel } from '../../domain/notification-type';
import type { DeliveryRepository } from '../ports/delivery-repository.port';
import type { PersonalNotificationRepository } from '../ports/inbox-repository.port';
import type { PushTokenRepository } from '../ports/push-token-repository.port';
import type { PushGateway, ProviderErrorClassifier } from '../ports/channel-gateways.port';
import type { RecipientDirectory } from '../ports/recipient-directory.port';
import type { ContactCipher } from '../ports/runtime.port';
import type { SendTemplatedEmail } from './send-templated-email.use-case';
import type { SmsSender } from './sms-sender';

const { errorMessage } = errorMessageModule;
const { forEachWithConcurrency } = concurrencyUtilModule;

/** Entregas por toma del despachador. */
const DISPATCH_BATCH = 50;
/**
 * Un ciclo toma de a DISPATCH_BATCH hasta vaciar lo vencido o agotar este tiempo (menos que el minuto del cron:
 * el siguiente ciclo sigue). Así una acumulación (fin del horario de silencio de muchos usuarios, vuelta de un
 * proveedor caído) se vacía en minutos y no a 50 por minuto.
 */
const DISPATCH_TIME_BUDGET_SECONDS = 45;
const DISPATCH_TIME_BUDGET_MS = DISPATCH_TIME_BUDGET_SECONDS * 1000;
/** Notificaciones que se envían a la vez dentro de un ciclo (no saturar proveedor ni pool de la base). */
const DISPATCH_CONCURRENCY = 10;

/** Envuelve el envío de un ciclo (el worker lo registra como operación). */
export type DispatchWrap = <T>(send: () => Promise<T>) => Promise<T | undefined>;

export class ScheduleDeliveries {
  constructor(
    private readonly deliveries: Pick<DeliveryRepository, 'createFor'>,
    private readonly logger: Logger
  ) {}

  /**
   * Crea las entregas de una notificación. `sendNow`: quedaron reservadas y quien llama las envía tras confirmar
   * la transacción (DeliveryAttempts.sendInBackground); si no, las toma el despachador.
   */
  async execute(
    notificationId: string,
    category: CategoryRules | null | undefined,
    preference: DeliveryPreference,
    { canSendNow }: { canSendNow: boolean }
  ): Promise<{ deliveries: ClaimedDelivery[]; sendNow: boolean }> {
    const plan = planDeliveries(category, preference, { canSendNow });
    const deliveries = await this.deliveries.createFor(notificationId, plan.channels, plan.firstAttemptAt);
    if (plan.deferUntil && plan.channels.length > 0) {
      this.logger.info('Envío diferido por horario de silencio', { notificationId, deferUntil: plan.deferUntil });
    }
    return { deliveries, sendNow: plan.sendNow };
  }
}

export interface DeliveryAttemptsDeps {
  deliveries: DeliveryRepository;
  notifications: Pick<PersonalNotificationRepository, 'findWithType'>;
  pushTokens: Pick<PushTokenRepository, 'findActiveByUser' | 'deactivate'>;
  recipients: Pick<RecipientDirectory, 'findRecipient'>;
  push: Pick<PushGateway, 'sendToDevice'>;
  email: Pick<SendTemplatedEmail, 'execute'>;
  sms: Pick<SmsSender, 'resolveE164' | 'send'>;
  providerErrors: ProviderErrorClassifier;
  cipher: Pick<ContactCipher, 'reveal'>;
  audit: AuditTrail;
  logger: Logger;
}

export class DeliveryAttempts {
  constructor(private readonly deps: DeliveryAttemptsDeps) {}

  /** Envía en segundo plano entregas ya reservadas. Llamar después de confirmar la transacción. */
  sendInBackground(deliveries: readonly ClaimedDelivery[], notification: PersonalNotification): void {
    setImmediate(() => {
      void this.attemptAll(deliveries, notification);
    });
  }

  /**
   * Intenta entregas ya tomadas, agrupadas por notificación. Los grupos van en paralelo, de a
   * DISPATCH_CONCURRENCY; dentro de un grupo, de a uno.
   */
  async deliverClaimed(claimed: readonly ClaimedDelivery[]): Promise<void> {
    await forEachWithConcurrency([...groupByNotification(claimed)], DISPATCH_CONCURRENCY, async ([notificationId, deliveries]) => {
      try {
        const notification = await this.deps.notifications.findWithType(notificationId);
        // Sin notificación sus entregas ya se borraron en cascada: no hay nada que enviar.
        if (notification) {
          await this.attemptAll(deliveries, notification);
        }
      } catch (error) {
        // Falló la lectura: la reserva vence y el despachador la retoma. No frena al resto.
        this.deps.logger.error('Error leyendo la notificación de una entrega', { error: errorMessage(error), notificationId });
      }
    });
  }

  /** Intenta las entregas de una notificación, una por una; ninguna aborta a las demás. */
  async attemptAll(deliveries: readonly ClaimedDelivery[], notification: PersonalNotification): Promise<void> {
    for (const delivery of deliveries) {
      try {
        await this.attempt(delivery, notification);
      } catch (error) {
        // Solo llega acá si falla la base al registrar el resultado: la reserva vence y se reintenta.
        this.deps.logger.error('Error registrando el intento de entrega', {
          error: errorMessage(error),
          notificationDeliveryId: delivery.notificationDeliveryId
        });
      }
    }
  }

  /** Un intento de una entrega: envía por su canal y registra el resultado. */
  async attempt(delivery: ClaimedDelivery, notification: PersonalNotification): Promise<DeliveryOutcome> {
    const { deliveries, logger } = this.deps;
    const outcome = await this.send(delivery.channel, notification);
    const id = delivery.notificationDeliveryId;

    if (outcome.status === 'sent') {
      await deliveries.markSent(id);
      return outcome;
    }
    if (outcome.status === 'skipped') {
      await deliveries.markSkipped(id, outcome.reason);
      logger.info('Entrega sin destinatario', { notificationDeliveryId: id, channel: delivery.channel, reason: outcome.reason });
      return outcome;
    }

    const attemptNumber = delivery.attempts + 1;
    const nextAttemptAt = nextAttemptAfterFailure(attemptNumber, outcome.permanent);
    await deliveries.recordFailure(id, { error: outcome.error, errorCode: outcome.errorCode, nextAttemptAt });

    if (nextAttemptAt === null) {
      await this.deps.audit.record(FAILED_DELIVERY_AUDIT_ACTION[delivery.channel], {
        actorId: null,
        details: {
          notificationId: notification.notificationId,
          notificationDeliveryId: id,
          userId: notification.userId,
          attempts: attemptNumber,
          reason: outcome.permanent ? 'hard_bounce' : 'attempts_exhausted',
          errorCode: outcome.errorCode,
          error: outcome.error
        },
        entityId: notification.notificationId,
        entityType: 'Notification',
        entityTable: 'notifications',
        outcome: 'failure'
      });
    } else {
      logger.warn('Entrega fallida, se reintenta', { notificationDeliveryId: id, channel: delivery.channel, attemptNumber, nextAttemptAt });
    }
    return outcome;
  }

  /** Envía por un canal. Nunca lanza: todo error vuelve como resultado. */
  async send(channel: Channel, notification: PersonalNotification): Promise<DeliveryOutcome> {
    try {
      if (channel === 'push') {
        return await this.sendPush(notification);
      }
      if (channel === 'email') {
        return await this.sendEmail(notification);
      }
      return await this.sendSms(notification);
    } catch (error) {
      const errorCode = this.deps.providerErrors.codeOf(error);
      return { status: 'error', error: errorMessage(error), errorCode, permanent: this.deps.providerErrors.isHardBounce(channel, errorCode) };
    }
  }

  /** A todos los dispositivos activos del usuario: basta con que llegue a uno. */
  private async sendPush(notification: PersonalNotification): Promise<DeliveryOutcome> {
    const { pushTokens, push, providerErrors } = this.deps;
    const devices = await pushTokens.findActiveByUser(notification.userId);
    if (devices.length === 0) {
      return { status: 'skipped', reason: 'Usuario sin dispositivos push activos' };
    }

    const message = { title: notification.title, body: notification.body, data: metadataOf(notification) };
    const results = await Promise.allSettled(devices.map(d => push.sendToDevice(d.token, message, notification.notificationId)));

    // Los dispositivos dados de baja no vuelven a recibir: se desactiva su token
    const codes = results.map(r => (r.status === 'rejected' ? providerErrors.codeOf(r.reason) : null));
    await this.deactivateDisabled(devices.filter((_, i) => providerErrors.isEndpointDisabled(codes[i] ?? null)).map(d => d.token));

    if (results.some(r => r.status === 'fulfilled')) {
      return { status: 'sent' };
    }
    // Rebote definitivo solo si TODOS fallaron con un código definitivo; si alguno fue temporal, se reintenta.
    const errors = results.map(r => (r as PromiseRejectedResult).reason);
    return {
      status: 'error',
      error: `Falló el envío a los ${devices.length} dispositivos: ${errorMessage(errors[0])}`,
      errorCode: codes[0] ?? null,
      permanent: codes.every(code => providerErrors.isHardBounce('push', code))
    };
  }

  /** No afecta el resultado de la entrega: si falla, solo se registra. */
  private async deactivateDisabled(tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) {
      return;
    }
    try {
      const deactivated = await this.deps.pushTokens.deactivate(tokens);
      this.deps.logger.info('Tokens push desactivados (EndpointDisabled)', { deactivated });
    } catch (error) {
      this.deps.logger.warn('No se pudieron desactivar tokens push', { error: errorMessage(error) });
    }
  }

  /** Al email de metadata.email (si viene) o al del contacto del usuario. */
  private async sendEmail(notification: PersonalNotification): Promise<DeliveryOutcome> {
    const metadata = metadataOf(notification);
    let email = typeof metadata.email === 'string' && metadata.email ? metadata.email : null;
    if (!email) {
      email = (await this.deps.recipients.findRecipient(notification.userId))?.email ?? null;
    }
    if (!email) {
      return { status: 'skipped', reason: 'Usuario sin email' };
    }
    if (!notification.notificationType) {
      return { status: 'skipped', reason: 'Notificación sin tipo: no hay plantilla de email' };
    }
    // El de metadata puede llegar cifrado: se envía en claro.
    const result = await this.deps.email.execute(this.deps.cipher.reveal(email), notification.notificationType, metadata, notification.notificationId);
    return result ? { status: 'sent' } : { status: 'skipped', reason: 'Dirección suprimida o tipo sin plantilla de email' };
  }

  /** Al teléfono de metadata.phone (si viene) o al principal del contacto, en E.164. */
  private async sendSms(notification: PersonalNotification): Promise<DeliveryOutcome> {
    const metadata = metadataOf(notification);
    let phoneNumber: string | null = null;
    let prefixId: string | null = null;

    if (typeof metadata.phone === 'string' && metadata.phone) {
      phoneNumber = metadata.phone;
      prefixId = typeof metadata.phonePrefixId === 'string' && metadata.phonePrefixId ? metadata.phonePrefixId : null;
    } else {
      const phone = (await this.deps.recipients.findRecipient(notification.userId))?.phone;
      if (phone?.number) {
        phoneNumber = this.deps.cipher.reveal(phone.number);
        prefixId = phone.prefixId || null;
      }
    }
    if (!phoneNumber) {
      return { status: 'skipped', reason: 'Usuario sin teléfono' };
    }

    const result = await this.deps.sms.send({
      phoneNumber: await this.deps.sms.resolveE164(phoneNumber, prefixId),
      message: (notification.body || '').slice(0, SMS_MAX_LENGTH),
      userId: notification.userId,
      purpose: 'notification'
    });
    // El proveedor no expone un código terminal para SMS: todo fallo se trata como temporal.
    return result?.success
      ? { status: 'sent' }
      : { status: 'error', error: result?.error || 'Envío SMS fallido', errorCode: null, permanent: false };
  }
}

export class DispatchDueDeliveries {
  private dispatching = false;

  constructor(
    private readonly deliveries: Pick<DeliveryRepository, 'claimDue'>,
    private readonly attempts: Pick<DeliveryAttempts, 'deliverClaimed'>
  ) {}

  /**
   * Un ciclo: toma las entregas vencidas y las intenta. No se solapa consigo mismo. `wrap` envuelve solo el
   * envío, y solo si hubo algo que tomar (un ciclo vacío por minuto no deja traza).
   */
  async execute(wrap: DispatchWrap = send => send()): Promise<{ attempted: number }> {
    if (this.dispatching) {
      return { attempted: 0 };
    }
    this.dispatching = true;
    try {
      const startedAt = Date.now();
      const first = await this.deliveries.claimDue(DISPATCH_BATCH, DELIVERY_LEASE_MS);
      if (first.length === 0) {
        return { attempted: 0 };
      }
      let attempted = first.length;
      await wrap(async () => {
        let claimed = first;
        for (;;) {
          await this.attempts.deliverClaimed(claimed);
          // Una toma incompleta: no queda nada vencido. Sin tiempo: sigue el próximo ciclo.
          if (claimed.length < DISPATCH_BATCH || Date.now() - startedAt >= DISPATCH_TIME_BUDGET_MS) {
            return;
          }
          claimed = await this.deliveries.claimDue(DISPATCH_BATCH, DELIVERY_LEASE_MS);
          attempted += claimed.length;
          if (claimed.length === 0) {
            return;
          }
        }
      });
      return { attempted };
    } finally {
      this.dispatching = false;
    }
  }
}
