// Envío de las notificaciones personales por canal externo (push / email / sms).
//
//   schedule()    → al crear la notificación (en su misma transacción): decide los canales (categoría +
//                   preferencia del usuario, salvo categoría crítica) y crea una entrega por canal. Si se
//                   pueden enviar ya, quedan reservadas y quien llama las envía con sendInBackground()
//                   tras confirmar la transacción.
//   dispatchDue() → el cron de cada minuto: toma las entregas vencidas (diferidas, reintentos, o las que
//                   quedaron a medias porque el proceso murió) y las intenta.
//   attempt()     → un intento: enviado / sin destinatario / error. Un error se reintenta con espera
//                   creciente; un rebote definitivo o el último intento la cierran como fallida (y se audita).
//
// Entrega al menos una vez: si el proceso muere entre que AWS acepta el envío y se marca `sent`, ese
// envío se repite al vencer la reserva (SES/SNS no aceptan una clave de idempotencia).
import type { NotificationChannel } from '../../../shared/infrastructure/database/generated/prisma/client';
import type * as Types from '../notification.types';
import notificationRepo from '../repositories/notification.repository';
import type { NotificationWithTypeAndCategory } from '../repositories/notification.repository';
import deliveryRepo from '../repositories/notification-delivery.repository';
import type { ClaimedDelivery } from '../repositories/notification-delivery.repository';
import userPushTokenRepo from '../repositories/user-push-token.repository';
import iamModule from '../../iam';
const { userRepository: userRepo } = iamModule;
import emailService from './email-notification.service';
import pushService from './push-notification.service';
import smsService from './sms.service';
import quietHours from '../utils/quiet-hours.util';
import EncryptionUtil from '../../../shared/infrastructure/security/encryption.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../../shared/kernel/error-message.util';
const { errorMessage } = errorMessageModule;
import concurrencyUtilModule from '../../../shared/kernel/concurrency.util';
const { forEachWithConcurrency } = concurrencyUtilModule;
import awsProviderMetaUtilModule from '../../../shared/infrastructure/providers/aws-provider-meta.util';
const { awsErrorCode } = awsProviderMetaUtilModule;
import awsErrorCodesModule from '../../../shared/infrastructure/providers/aws-error-codes';
const { isHardBounce, isEndpointDisabled } = awsErrorCodesModule;
import auditModule from '../../audit';
const { audit } = auditModule;

const MINUTE_MS = 60 * 1000;
/** Espera antes de cada reintento: tras el 1er fallo 1 min, tras el 2º 5 min... Después del último, fallida. */
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- la tabla de esperas (en minutos) es la configuración
const RETRY_DELAYS_MS = [1, 5, 30, 120, 360].map(minutes => minutes * MINUTE_MS);
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Reserva de un intento en curso: si el proceso muere, la entrega vuelve a estar vencida al terminar. */
const LEASE_MINUTES = 5;
export const LEASE_MS = LEASE_MINUTES * MINUTE_MS;
/** Entregas por toma del despachador. */
const DISPATCH_BATCH = 50;
/**
 * Un ciclo toma de a DISPATCH_BATCH hasta vaciar lo vencido o agotar este tiempo (menos que el minuto del
 * cron: el siguiente ciclo sigue). Así una acumulación (fin del horario de silencio de muchos usuarios,
 * vuelta de un proveedor caído) se vacía en minutos y no a 50 por minuto.
 */
const DISPATCH_TIME_BUDGET_SECONDS = 45;
const DISPATCH_TIME_BUDGET_MS = DISPATCH_TIME_BUDGET_SECONDS * 1000;
/** Notificaciones que se envían a la vez dentro de un ciclo (acotado: no saturar proveedor ni pool de la base). */
const DISPATCH_CONCURRENCY = 10;
const SMS_MAX_LENGTH = 160;
const CHANNELS: readonly NotificationChannel[] = ['push', 'email', 'sms'];
/** Soporte por defecto si la categoría no lo declara (o el tipo no tiene categoría). */
const SUPPORTED_BY_DEFAULT: Record<NotificationChannel, boolean> = { push: true, email: true, sms: false };

const FAILED_AUDIT_ACTION = {
  push: 'PUSH_DELIVERY_FAILED',
  email: 'EMAIL_DELIVERY_FAILED',
  sms: 'SMS_DELIVERY_FAILED'
} as const;

/** 'email' → 'Email': sufijo de los campos supports<Canal> / allow<Canal>. */
const cap = <K extends string>(key: K) => (key.charAt(0).toUpperCase() + key.slice(1)) as Capitalize<K>;

/** Código del proveedor de un error (`name` del SDK, p. ej. MessageRejected), como texto; null si no trae. */
const providerErrorCode = (error: unknown) => {
  const code = awsErrorCode(error);
  return code === null || code === 'Error' ? null : String(code);
};

class NotificationDeliveryService {
  notificationRepo: typeof notificationRepo;
  deliveryRepo: typeof deliveryRepo;
  userRepo: typeof userRepo;
  userPushTokenRepo: typeof userPushTokenRepo;
  emailService: typeof emailService;
  pushService: typeof pushService;
  smsService: typeof smsService;
  private dispatching = false;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones reales:
   *   new NotificationDeliveryService({ deliveryRepo: fake })
   */
  constructor(deps: NotificationDeliveryService.Deps = {}) {
    this.notificationRepo = deps.notificationRepo ?? notificationRepo;
    this.deliveryRepo = deps.deliveryRepo ?? deliveryRepo;
    this.userRepo = deps.userRepo ?? userRepo;
    this.userPushTokenRepo = deps.userPushTokenRepo ?? userPushTokenRepo;
    this.emailService = deps.emailService ?? emailService;
    this.pushService = deps.pushService ?? pushService;
    this.smsService = deps.smsService ?? smsService;
  }

  /** Canales por los que sale: los que soporta la categoría y, salvo categoría crítica, permite el usuario. */
  channelsFor(notificationType: Types.NotificationTypeSource, preference: Types.UserPreference): NotificationChannel[] {
    const category = notificationType.category ?? null;
    const critical = category?.isCritical === true;
    return CHANNELS.filter(channel => {
      const supported = category?.[`supports${cap(channel)}`] ?? SUPPORTED_BY_DEFAULT[channel];
      const allowed = critical || (preference?.[`allow${cap(channel)}`] ?? true);
      return supported && allowed;
    });
  }

  /**
   * Crea las entregas de una notificación. En horario de silencio (categoría no crítica) quedan para el
   * final del horario. Si no, y `canSendNow`, quedan reservadas para que quien llama las envíe tras
   * confirmar (`sendNow: true`); si no se puede enviar ya, las toma el próximo ciclo del despachador.
   */
  async schedule(
    notificationId: string,
    notificationType: Types.NotificationTypeSource,
    preference: Types.UserPreference,
    { canSendNow }: { canSendNow: boolean }
  ) {
    const channels = this.channelsFor(notificationType, preference);
    const critical = notificationType.category?.isCritical === true;
    const deferUntil = !critical && quietHours.isInQuietHours(preference) ? quietHours.endOfQuietHours(preference) : null;
    const sendNow = channels.length > 0 && deferUntil === null && canSendNow;
    const firstAttemptAt = deferUntil ?? (sendNow ? new Date(Date.now() + LEASE_MS) : new Date());

    const deliveries = await this.deliveryRepo.createForNotification(notificationId, channels, firstAttemptAt);
    if (deferUntil && channels.length > 0) {
      logger.info('Envío diferido por horario de silencio', { notificationId, deferUntil });
    }
    return { deliveries, sendNow };
  }

  /** Envía en segundo plano entregas ya reservadas por schedule(). Llamar después de confirmar la transacción. */
  sendInBackground(deliveries: readonly ClaimedDelivery[], notification: NotificationWithTypeAndCategory) {
    setImmediate(() => {
      void this.attemptAll(deliveries, notification);
    });
  }

  /**
   * Un ciclo del despachador: toma las entregas vencidas y las intenta. No se solapa consigo mismo.
   * `wrap` envuelve solo la parte de envío, y solo si hubo algo que tomar (el worker la registra como
   * operación; un ciclo vacío por minuto no deja traza).
   */
  async dispatchDue(wrap: <T>(send: () => Promise<T>) => Promise<T | undefined> = send => send()) {
    if (this.dispatching) {
      return { attempted: 0 };
    }
    this.dispatching = true;
    try {
      const startedAt = Date.now();
      const first = await this.deliveryRepo.claimDue(DISPATCH_BATCH, LEASE_MS);
      if (first.length === 0) {
        return { attempted: 0 };
      }
      let attempted = first.length;
      await wrap(async () => {
        let claimed = first;
        for (;;) {
          await this.deliverClaimed(claimed);
          // Una toma incompleta: no queda nada vencido. Sin tiempo: sigue el próximo ciclo.
          if (claimed.length < DISPATCH_BATCH || Date.now() - startedAt >= DISPATCH_TIME_BUDGET_MS) {
            return;
          }
          claimed = await this.deliveryRepo.claimDue(DISPATCH_BATCH, LEASE_MS);
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

  /**
   * Intenta entregas ya tomadas, agrupadas por notificación (una lectura de la notificación por grupo).
   * Los grupos van en paralelo, de a DISPATCH_CONCURRENCY; dentro de un grupo, de a uno.
   */
  async deliverClaimed(claimed: readonly ClaimedDelivery[]) {
    const byNotification = new Map<string, ClaimedDelivery[]>();
    for (const delivery of claimed) {
      byNotification.set(delivery.notificationId, [...(byNotification.get(delivery.notificationId) ?? []), delivery]);
    }
    await forEachWithConcurrency([...byNotification], DISPATCH_CONCURRENCY, async ([notificationId, deliveries]) => {
      try {
        const notification = await this.notificationRepo.findByIdWithType(notificationId);
        // Sin notificación sus entregas ya se borraron en cascada: no hay nada que enviar.
        if (notification) {
          await this.attemptAll(deliveries, notification);
        }
      } catch (error) {
        // Falló la lectura de la notificación: la reserva vence y el despachador la retoma. No frena al resto.
        logger.error('Error leyendo la notificación de una entrega', { error: errorMessage(error), notificationId });
      }
    });
  }

  /** Intenta las entregas de una notificación, una por una; ninguna aborta a las demás. */
  async attemptAll(deliveries: readonly ClaimedDelivery[], notification: NotificationWithTypeAndCategory) {
    for (const delivery of deliveries) {
      try {
        await this.attempt(delivery, notification);
      } catch (error) {
        // Solo llega aquí si falla la base al registrar el resultado: la reserva vence y se reintenta.
        logger.error('Error registrando el intento de entrega', {
          error: errorMessage(error),
          notificationDeliveryId: delivery.notificationDeliveryId
        });
      }
    }
  }

  /** Un intento de una entrega: envía por su canal y registra el resultado. */
  async attempt(delivery: ClaimedDelivery, notification: NotificationWithTypeAndCategory) {
    const outcome = await this.send(delivery.channel, notification);
    const id = delivery.notificationDeliveryId;

    if (outcome.status === 'sent') {
      await this.deliveryRepo.markSent(id);
      return outcome;
    }
    if (outcome.status === 'skipped') {
      await this.deliveryRepo.markSkipped(id, outcome.reason);
      logger.info('Entrega sin destinatario', { notificationDeliveryId: id, channel: delivery.channel, reason: outcome.reason });
      return outcome;
    }

    const attemptNumber = delivery.attempts + 1;
    const final = outcome.permanent || attemptNumber >= MAX_ATTEMPTS;
    const nextAttemptAt = final ? null : new Date(Date.now() + RETRY_DELAYS_MS[attemptNumber - 1]!);
    await this.deliveryRepo.recordFailure(id, { error: outcome.error, errorCode: outcome.errorCode, nextAttemptAt });

    if (final) {
      await audit.record(FAILED_AUDIT_ACTION[delivery.channel], {
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
      logger.warn('Entrega fallida, se reintenta', {
        notificationDeliveryId: id,
        channel: delivery.channel,
        attemptNumber,
        nextAttemptAt
      });
    }
    return outcome;
  }

  /** Envía por un canal. Nunca lanza: todo error del proveedor vuelve como resultado. */
  async send(
    channel: NotificationChannel,
    notification: NotificationWithTypeAndCategory
  ): Promise<NotificationDeliveryService.Outcome> {
    try {
      if (channel === 'push') {
        return await this.sendPush(notification);
      }
      if (channel === 'email') {
        return await this.sendEmail(notification);
      }
      return await this.sendSms(notification);
    } catch (error) {
      const errorCode = providerErrorCode(error);
      return { status: 'error', error: errorMessage(error), errorCode, permanent: isHardBounce(channel, errorCode) };
    }
  }

  /** A todos los dispositivos activos del usuario: basta con que llegue a uno. */
  async sendPush(notification: NotificationWithTypeAndCategory): Promise<NotificationDeliveryService.Outcome> {
    const tokens = await this.userPushTokenRepo.findActiveByUser(notification.userId);
    if (tokens.length === 0) {
      return { status: 'skipped', reason: 'Usuario sin dispositivos push activos' };
    }

    const metadata = metadataOf(notification);
    const results = await Promise.allSettled(
      tokens.map(t =>
        this.pushService.enviarPushIndividual(
          t.token,
          notification.title,
          notification.body,
          metadata,
          notification.notificationId
        )
      )
    );

    // Los dispositivos dados de baja (EndpointDisabled) no vuelven a recibir: se desactiva su token
    const codes = results.map(r => (r.status === 'rejected' ? providerErrorCode(r.reason) : null));
    await this.deactivateDisabledTokens(tokens.filter((_, i) => isEndpointDisabled(codes[i])).map(t => t.token));

    if (results.some(r => r.status === 'fulfilled')) {
      return { status: 'sent' };
    }

    // Rebote definitivo solo si TODOS los dispositivos fallaron con un código definitivo (p. ej. todos
    // EndpointDisabled). Si alguno falló por algo temporal, se reintenta.
    const errors = results.map(r => (r as PromiseRejectedResult).reason);
    return {
      status: 'error',
      error: `Falló el envío a los ${tokens.length} dispositivos: ${errorMessage(errors[0])}`,
      errorCode: codes[0] ?? null,
      permanent: codes.every(code => isHardBounce('push', code))
    };
  }

  /** Desactiva tokens dados de baja. No afecta el resultado de la entrega: si falla, solo se registra. */
  async deactivateDisabledTokens(tokens: readonly string[]) {
    if (tokens.length === 0) {
      return;
    }
    try {
      const deactivated = await this.userPushTokenRepo.deactivateTokens(tokens);
      logger.info('Tokens push desactivados (EndpointDisabled)', { deactivated });
    } catch (error) {
      logger.warn('No se pudieron desactivar tokens push', { error: errorMessage(error) });
    }
  }

  /** Al email de metadata.email (si viene) o al del contacto del usuario. */
  async sendEmail(notification: NotificationWithTypeAndCategory): Promise<NotificationDeliveryService.Outcome> {
    const metadata = metadataOf(notification);
    let email = typeof metadata.email === 'string' && metadata.email ? metadata.email : null;
    if (!email) {
      const user = await this.userRepo.findByUserId(notification.userId, 'minimal');
      email = user?.person?.contact?.email ?? null;
    }
    if (!email) {
      return { status: 'skipped', reason: 'Usuario sin email' };
    }
    if (!notification.notificationType) {
      return { status: 'skipped', reason: 'Notificación sin tipo: no hay plantilla de email' };
    }

    // El de metadata puede llegar cifrado (ivHex:authTagHex:cipherHex); safeDecrypt deja intacto el claro.
    const result = await this.emailService.enviarNotificacion(
      EncryptionUtil.safeDecrypt(email),
      notification.notificationType,
      metadata,
      notification.notificationId
    );
    // null: la dirección está suprimida (rebotó antes) o el tipo no tiene plantilla de email.
    return result ? { status: 'sent' } : { status: 'skipped', reason: 'Dirección suprimida o tipo sin plantilla de email' };
  }

  /** Al teléfono de metadata.phone (si viene) o al principal del contacto, normalizado a E.164. */
  async sendSms(notification: NotificationWithTypeAndCategory): Promise<NotificationDeliveryService.Outcome> {
    const metadata = metadataOf(notification);
    let phoneNumber: string | null = null;
    let prefixId: string | null = null;

    if (typeof metadata.phone === 'string' && metadata.phone) {
      phoneNumber = metadata.phone;
      prefixId = typeof metadata.phonePrefixId === 'string' && metadata.phonePrefixId ? metadata.phonePrefixId : null;
    } else {
      const contact = (await this.userRepo.findByUserId(notification.userId, 'minimal'))?.person?.contact;
      if (contact?.phonePrimary) {
        // Ya llega descifrado (piiExtension); safeDecrypt es idempotente si viene en claro.
        phoneNumber = EncryptionUtil.safeDecrypt(contact.phonePrimary);
        prefixId = contact.phonePrimaryPrefixId || null;
      }
    }
    if (!phoneNumber) {
      return { status: 'skipped', reason: 'Usuario sin teléfono' };
    }

    const e164 = await this.smsService.resolveE164(phoneNumber, prefixId);
    const result = await this.smsService.enviarSms({
      phoneNumber: e164,
      message: (notification.body || '').slice(0, SMS_MAX_LENGTH),
      userId: notification.userId,
      purpose: 'notification'
    });
    // SNS no expone un código terminal para SMS: todo fallo se trata como temporal.
    return result?.success
      ? { status: 'sent' }
      : { status: 'error', error: result?.error || 'Envío SMS fallido', errorCode: null, permanent: false };
  }
}

function metadataOf(notification: Pick<NotificationWithTypeAndCategory, 'metadata'>): Record<string, unknown> {
  return (notification.metadata as Record<string, unknown> | null) ?? {};
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationDeliveryService {
  /** Resultado de un intento por un canal. */
  export type Outcome =
    | { status: 'sent' }
    | { status: 'skipped'; reason: string }
    | { status: 'error'; error: string; errorCode: string | null; permanent: boolean };

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    notificationRepo?: typeof notificationRepo;
    deliveryRepo?: typeof deliveryRepo;
    userRepo?: typeof userRepo;
    userPushTokenRepo?: typeof userPushTokenRepo;
    emailService?: typeof emailService;
    pushService?: typeof pushService;
    smsService?: typeof smsService;
  }
}

export default Object.assign(new NotificationDeliveryService(), { NotificationDeliveryService });
