// Envío masivo de las notificaciones globales (push + email a todos los clientes activos), por páginas y con
// el avance guardado (domain/broadcast.ts). Cada usuario filtra con su preferencia (una consulta por página),
// salvo categoría crítica.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import {
  BROADCAST_LEASE_MS,
  BROADCAST_PAGE_SIZE,
  EMAIL_CHUNK,
  PUSH_CHUNK,
  chunks,
  type BroadcastRecipient
} from '../../domain/broadcast';
import { metadataOf, type GlobalNotification } from '../../domain/notification';
import { allowsChannel } from '../../domain/notification-preference';
import { isCritical, type NotificationType } from '../../domain/notification-type';
import type { GlobalNotificationRepository } from '../ports/inbox-repository.port';
import type { NotificationPreferenceRepository } from '../ports/preference-repository.port';
import type { PushTokenRepository } from '../ports/push-token-repository.port';
import type { PushGateway, SendRateLimiter } from '../ports/channel-gateways.port';
import type { RecipientDirectory } from '../ports/recipient-directory.port';
import type { ContactCipher } from '../ports/runtime.port';
import type { SendTemplatedEmail } from './send-templated-email.use-case';
import type { DispatchWrap } from './deliveries.use-cases';

const { errorMessage } = errorMessageModule;

export interface BroadcastDeps {
  globals: Pick<GlobalNotificationRepository, 'claimDue' | 'recordProgress' | 'finish'>;
  recipients: Pick<RecipientDirectory, 'activeClientsAfter'>;
  preferences: Pick<NotificationPreferenceRepository, 'findByUsers'>;
  pushTokens: Pick<PushTokenRepository, 'findActiveByUsers' | 'deactivate'>;
  push: Pick<PushGateway, 'sendToMany'>;
  email: Pick<SendTemplatedEmail, 'execute'>;
  rateLimiter: SendRateLimiter;
  cipher: Pick<ContactCipher, 'reveal'>;
  logger: Logger;
}

export class BroadcastGlobalNotification {
  private dispatching = false;

  constructor(private readonly deps: BroadcastDeps) {}

  /** Envía en segundo plano una global recién creada (ya reservada). Si falla, la retoma el despachador. */
  sendInBackground(notification: GlobalNotification): void {
    setImmediate(() => {
      this.send(notification).catch((error: unknown) => {
        this.deps.logger.warn('Envío masivo interrumpido; lo retoma el despachador', {
          error: errorMessage(error),
          globalNotificationId: notification.globalNotificationId
        });
      });
    });
  }

  /**
   * Un ciclo del despachador: retoma los envíos pendientes o a medias cuya reserva venció. `wrap` envuelve solo
   * el envío, y solo si hubo algo que retomar. No se solapa consigo mismo.
   */
  async dispatchDue(wrap: DispatchWrap = send => send()): Promise<{ resumed: number }> {
    if (this.dispatching) {
      return { resumed: 0 };
    }
    this.dispatching = true;
    try {
      const claimed = await this.deps.globals.claimDue(BROADCAST_LEASE_MS);
      if (claimed.length > 0) {
        await wrap(async () => {
          for (const notification of claimed) {
            await this.send(notification);
          }
        });
      }
      return { resumed: claimed.length };
    } finally {
      this.dispatching = false;
    }
  }

  /** Envía desde el cursor hasta el último cliente, guardando el avance en cada página. */
  async send(notification: GlobalNotification): Promise<void> {
    const { globals, recipients, logger } = this.deps;
    const id = notification.globalNotificationId;
    const type = notification.notificationType;
    if (!type) {
      logger.warn('Notificación global sin tipo: no se puede enviar', { globalNotificationId: id });
      await globals.finish(id, 'failed');
      return;
    }

    let cursor = notification.cursorUserId;
    for (;;) {
      const users = await recipients.activeClientsAfter(cursor, BROADCAST_PAGE_SIZE);
      if (users.length === 0) {
        break;
      }
      const { pushSent, emailSent } = await this.sendPage(notification, type, users);
      cursor = users[users.length - 1]!.userId;
      await globals.recordProgress(id, { cursorUserId: cursor, pushSent, emailSent, leaseMs: BROADCAST_LEASE_MS });
      if (users.length < BROADCAST_PAGE_SIZE) {
        break;
      }
    }

    await globals.finish(id, 'completed');
    logger.info('Notificación global enviada', { globalNotificationId: id });
  }

  /** Una página de clientes: push y email a quienes los permiten. Devuelve cuántos se enviaron. */
  private async sendPage(notification: GlobalNotification, type: NotificationType, users: readonly BroadcastRecipient[]) {
    const { preferences, pushTokens, push, email, rateLimiter, cipher, logger } = this.deps;
    const critical = isCritical(type.category);
    const byUser = await preferences.findByUsers(users.map(u => u.userId));
    const allows = (userId: string, channel: 'push' | 'email') => critical || allowsChannel(byUser.get(userId), channel);
    const metadata = metadataOf(notification);

    let pushSent = 0;
    if (notification.sendPush) {
      const devices = await pushTokens.findActiveByUsers(users.filter(u => allows(u.userId, 'push')).map(u => u.userId));
      for (const chunk of chunks(devices, PUSH_CHUNK)) {
        await rateLimiter.acquire('push', chunk.length);
        const stats = await push.sendToMany(
          chunk.map(d => d.token),
          { title: notification.title, body: notification.body, data: metadata }
        );
        pushSent += stats.success;
        await this.deactivateDisabled(stats.disabledEndpoints);
      }
    }

    let emailSent = 0;
    if (notification.sendEmail) {
      const addresses = users.flatMap(u => (u.email && allows(u.userId, 'email') ? [cipher.reveal(u.email)] : []));
      for (const chunk of chunks(addresses, EMAIL_CHUNK)) {
        await rateLimiter.acquire('email', chunk.length);
        const results = await Promise.allSettled(chunk.map(address => email.execute(address, type, metadata)));
        // null: dirección suprimida (no se envió)
        emailSent += results.filter(r => r.status === 'fulfilled' && r.value).length;
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed > 0) {
          logger.warn('Emails de notificación global fallidos', { globalNotificationId: notification.globalNotificationId, failed });
        }
      }
    }

    return { pushSent, emailSent };
  }

  /** Si falla, solo se registra: no frena el envío. */
  private async deactivateDisabled(tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) {
      return;
    }
    try {
      await this.deps.pushTokens.deactivate(tokens);
    } catch (error) {
      this.deps.logger.warn('No se pudieron desactivar tokens push', { error: errorMessage(error) });
    }
  }
}
