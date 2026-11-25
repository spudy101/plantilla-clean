// El contador de no leídas (personales + globales) y su aviso en tiempo real a las conexiones SSE.
//
// Los flujos que lo alteran (crear una notificación, marcar leídas) lo refrescan SIEMPRE en segundo plano
// (setImmediate), nunca en el flujo principal, y ninguna de estas funciones lanza: un fallo acá no tumba la
// petición.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { GlobalNotificationRepository, PersonalNotificationRepository } from '../ports/inbox-repository.port';
import type { UnreadCountChannel } from '../ports/runtime.port';

const { errorMessage } = errorMessageModule;

export class UnreadCounter {
  constructor(
    private readonly personal: Pick<PersonalNotificationRepository, 'countUnreadByUser'>,
    private readonly globals: Pick<GlobalNotificationRepository, 'countUnreadByUser'>,
    private readonly channel: UnreadCountChannel,
    private readonly logger: Logger
  ) {}

  /** El cálculo puro (sin avisar ni auditar). */
  async compute(userId: string): Promise<number> {
    const [personalCount, globalCount] = await Promise.all([this.personal.countUnreadByUser(userId), this.globals.countUnreadByUser(userId)]);
    return personalCount + globalCount;
  }

  /** Recalcula el contador del usuario y lo publica a sus conexiones abiertas. */
  async refresh(userId: string): Promise<void> {
    try {
      const count = await this.compute(userId);
      this.channel.publish({ userId, count });
      // Si el número no llega al front: dice si el server lo emitió, por qué transporte (redis cruza instancias;
      // local, solo esta) y cuántas conexiones escuchan acá (0 con 'local' en varias instancias = falta Redis).
      this.logger.info('[NotificationCount] count-updated emitido', {
        userId,
        count,
        transport: this.channel.transport(),
        localListeners: this.channel.listenerCount()
      });
    } catch (error) {
      this.logger.error('[NotificationCount] Error emitiendo count-updated', { userId, error: errorMessage(error) });
    }
  }

  /**
   * Tras una notificación GLOBAL (una sola fila para todos, sin fan-out por destinatario): cada conexión abierta
   * recibe { global: true } y recalcula su propio contador.
   */
  invalidateAll(): void {
    try {
      this.channel.publish({ global: true });
    } catch (error) {
      this.logger.error('[NotificationCount] Error emitiendo invalidación global', { error: errorMessage(error) });
    }
  }

  /** refresh() en segundo plano. */
  refreshLater(userId: string): void {
    setImmediate(() => {
      void this.refresh(userId);
    });
  }

  /** invalidateAll() en segundo plano. */
  invalidateAllLater(): void {
    setImmediate(() => this.invalidateAll());
  }
}
