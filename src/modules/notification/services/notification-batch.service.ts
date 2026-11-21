// Envío masivo de las notificaciones globales (push + email a todos los clientes activos).
//
// Va por páginas de usuarios ordenadas por user_id. Después de cada página guarda en la fila el último
// user_id enviado (cursor), suma los enviados y renueva la reserva (locked_until). Si el proceso muere,
// la reserva vence y el despachador (dispatchDue, cada minuto) lo retoma desde el cursor: no vuelve a
// empezar ni queda colgado. Igual que las entregas individuales es "al menos una vez": la página en curso
// al morir se reenvía.
//
// Cada usuario filtra con su preferencia (una consulta por página), salvo categoría crítica.
import iamModule from '../../iam';
const { userRepository } = iamModule;
import globalNotificationRepo from '../repositories/global-notification.repository';
import type { GlobalNotificationWithType } from '../repositories/global-notification.repository';
import userNotificationPreferenceRepo from '../repositories/user-notification-preference.repository';
import userPushTokenRepo from '../repositories/user-push-token.repository';
import EncryptionUtil from '../../../shared/security/encryption.util';
import emailService from './email-notification.service';
import pushService from './push-notification.service';
import rateLimitService from './notification-rate-limit.service';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/constants';
const { CLIENT_ROLE_NAMES } = constantsModule;
import errorMessageModule from '../../../shared/utils/error-message.util';
const { errorMessage } = errorMessageModule;

const MINUTE_MS = 60 * 1000;
/** Usuarios por página (y por avance guardado). */
const PAGE_SIZE = 100;
/** Tokens por llamada masiva a SNS y emails por tanda a SES: lo que descuenta el rate limit de cada uno. */
const PUSH_CHUNK = 100;
const EMAIL_CHUNK = 50;
/** Reserva del envío en curso; se renueva en cada página. */
const LEASE_MINUTES = 5;
export const LEASE_MS = LEASE_MINUTES * MINUTE_MS;

type PageUser = Awaited<ReturnType<typeof userRepository.findActivePageByRoleNames>>[number];

const chunks = <T>(items: readonly T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

class NotificationBatchService {
  userRepository: typeof userRepository;
  globalNotificationRepo: typeof globalNotificationRepo;
  userNotificationPreferenceRepo: typeof userNotificationPreferenceRepo;
  userPushTokenRepo: typeof userPushTokenRepo;
  emailService: typeof emailService;
  pushService: typeof pushService;
  rateLimitService: typeof rateLimitService;
  private dispatching = false;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones reales:
   *   new NotificationBatchService({ globalNotificationRepo: fake })
   */
  constructor(deps: NotificationBatchService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.globalNotificationRepo = deps.globalNotificationRepo ?? globalNotificationRepo;
    this.userNotificationPreferenceRepo = deps.userNotificationPreferenceRepo ?? userNotificationPreferenceRepo;
    this.userPushTokenRepo = deps.userPushTokenRepo ?? userPushTokenRepo;
    this.emailService = deps.emailService ?? emailService;
    this.pushService = deps.pushService ?? pushService;
    this.rateLimitService = deps.rateLimitService ?? rateLimitService;
  }

  /** Envía en segundo plano una global recién creada (ya reservada). Si falla, la retoma el despachador. */
  sendInBackground(globalNotification: GlobalNotificationWithType) {
    setImmediate(() => {
      this.send(globalNotification).catch((error: unknown) => {
        logger.warn('Envío masivo interrumpido; lo retoma el despachador', {
          error: errorMessage(error),
          globalNotificationId: globalNotification.globalNotificationId
        });
      });
    });
  }

  /**
   * Un ciclo del despachador: retoma los envíos masivos pendientes o a medias cuya reserva venció. `wrap`
   * envuelve solo el envío, y solo si hubo algo que retomar. No se solapa consigo mismo.
   */
  async dispatchDue(wrap: <T>(send: () => Promise<T>) => Promise<T | undefined> = send => send()) {
    if (this.dispatching) {
      return { resumed: 0 };
    }
    this.dispatching = true;
    try {
      const claimed = await this.globalNotificationRepo.claimDue(LEASE_MS);
      if (claimed.length > 0) {
        await wrap(async () => {
          for (const globalNotification of claimed) {
            await this.send(globalNotification);
          }
        });
      }
      return { resumed: claimed.length };
    } finally {
      this.dispatching = false;
    }
  }

  /** Envía desde el cursor hasta el último usuario, guardando el avance en cada página. */
  async send(globalNotification: GlobalNotificationWithType) {
    const id = globalNotification.globalNotificationId;
    if (!globalNotification.notificationType) {
      logger.warn('Notificación global sin tipo: no se puede enviar', { globalNotificationId: id });
      await this.globalNotificationRepo.finish(id, 'failed');
      return;
    }

    let cursor = globalNotification.cursorUserId;
    for (;;) {
      // Solo a clientes finales, nunca a usuarios internos.
      const users = await this.userRepository.findActivePageByRoleNames(CLIENT_ROLE_NAMES, cursor, PAGE_SIZE);
      if (users.length === 0) {
        break;
      }
      const { pushSent, emailSent } = await this.sendPage(globalNotification, users);
      cursor = users[users.length - 1]!.userId;
      await this.globalNotificationRepo.recordPage(id, { cursorUserId: cursor, pushSent, emailSent, leaseMs: LEASE_MS });
      if (users.length < PAGE_SIZE) {
        break;
      }
    }

    await this.globalNotificationRepo.finish(id, 'completed');
    logger.info('Notificación global enviada', { globalNotificationId: id });
  }

  /** Desactiva tokens dados de baja (EndpointDisabled). Si falla, solo se registra: no frena el envío. */
  async deactivateDisabledTokens(tokens: readonly string[]) {
    if (tokens.length === 0) {
      return;
    }
    try {
      await this.userPushTokenRepo.deactivateTokens(tokens);
    } catch (error) {
      logger.warn('No se pudieron desactivar tokens push', { error: errorMessage(error) });
    }
  }

  /** Una página de usuarios: push y email a quienes los permiten. Devuelve cuántos se enviaron. */
  async sendPage(globalNotification: GlobalNotificationWithType, users: readonly PageUser[]) {
    const type = globalNotification.notificationType!;
    const critical = type.category?.isCritical === true;
    const preferences = await this.userNotificationPreferenceRepo.findByUsers(users.map(u => u.userId));
    const allows = (userId: string, channel: 'allowPush' | 'allowEmail') =>
      critical || (preferences.get(userId)?.[channel] ?? true);
    const metadata = (globalNotification.metadata as Record<string, unknown> | null) ?? {};

    let pushSent = 0;
    if (globalNotification.sendPush) {
      const tokens = await this.userPushTokenRepo.findActiveByUsers(
        users.filter(u => allows(u.userId, 'allowPush')).map(u => u.userId)
      );
      for (const chunk of chunks(tokens, PUSH_CHUNK)) {
        await this.rateLimitService.checkSNSRateLimit(chunk.length);
        const stats = await this.pushService.enviarPushMasivo(
          chunk.map(t => t.token),
          globalNotification.title,
          globalNotification.body,
          metadata
        );
        pushSent += stats.success;
        await this.deactivateDisabledTokens(stats.disabledEndpoints);
      }
    }

    let emailSent = 0;
    if (globalNotification.sendEmail) {
      const recipients = users.flatMap(u => {
        const email = u.person?.contact?.email;
        return email && allows(u.userId, 'allowEmail') ? [EncryptionUtil.safeDecrypt(email)] : [];
      });
      for (const chunk of chunks(recipients, EMAIL_CHUNK)) {
        await this.rateLimitService.checkSESRateLimit(chunk.length);
        const results = await Promise.allSettled(chunk.map(email => this.emailService.enviarNotificacion(email, type, metadata)));
        // null: dirección suprimida (no se envió)
        emailSent += results.filter(r => r.status === 'fulfilled' && r.value).length;
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed > 0) {
          logger.warn('Emails de notificación global fallidos', {
            globalNotificationId: globalNotification.globalNotificationId,
            failed
          });
        }
      }
    }

    return { pushSent, emailSent };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationBatchService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    globalNotificationRepo?: typeof globalNotificationRepo;
    userNotificationPreferenceRepo?: typeof userNotificationPreferenceRepo;
    userPushTokenRepo?: typeof userPushTokenRepo;
    emailService?: typeof emailService;
    pushService?: typeof pushService;
    rateLimitService?: typeof rateLimitService;
  }
}

export default Object.assign(new NotificationBatchService(), { NotificationBatchService });
