// modules/notification/utils/notification-emitter.util.ts
//
// Avisa a los streams SSE abiertos que cambió el contador de no leídas de un usuario (o de todos, en una
// global). Con Redis, el evento viaja por Pub/Sub y llega a todas las instancias; sin Redis, queda en la
// instancia local (EventEmitter). Solo transporta 'count-updated'.
import { interopDefault } from '../../../shared/kernel/interop.util';
import EventEmitter from 'node:events';
import type { Redis } from 'ioredis';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;

const COUNT_EVENT = 'count-updated';
const COUNT_CHANNEL = 'notification:count-updated';

class NotificationEmitter extends EventEmitter {
  useRedis = false;
  subscriberClient: Redis | null = null;
  publisherClient: Redis | null = null;
  initialized = false;

  /** Conecta el Pub/Sub de Redis. Se llama desde src/server.ts DESPUÉS de conectar Redis. */
  async initialize() {
    if (this.initialized) {
      return;
    }
    try {
      const redisClient = interopDefault(require('../../../shared/infrastructure/cache/redis.util') as typeof import('../../../shared/infrastructure/cache/redis.util'));
      const client = redisClient.isAvailable() ? redisClient.getClient() : null;
      if (client) {
        this.publisherClient = client;
        const subscriber = client.duplicate();
        this.subscriberClient = subscriber;
        await subscriber.connect();
        // ioredis entrega lo publicado por el evento 'message' (el callback de subscribe() solo confirma
        // la suscripción): sin este handler, lo publicado se descarta en silencio.
        subscriber.on('message', (channel: string, message: string) => {
          try {
            if (channel === COUNT_CHANNEL) {
              super.emit(COUNT_EVENT, JSON.parse(message));
            }
          } catch (error) {
            logger.warn('Error parsing Redis pub/sub message', { channel, error: errorMessage(error) });
          }
        });
        await subscriber.subscribe(COUNT_CHANNEL);
        this.useRedis = true;
        logger.info('✓ NotificationEmitter: Redis Pub/Sub habilitado');
      } else {
        logger.info('⚠ NotificationEmitter: Redis no disponible, usando EventEmitter local');
      }
    } catch (error) {
      logger.warn('Error initializing Redis Pub/Sub, using local EventEmitter', { error: errorMessage(error) });
      this.useRedis = false;
    }
    this.initialized = true;
  }

  /** 'count-updated' viaja por Redis (todas las instancias); cualquier otro evento queda local. */
  override emit(event: string | symbol, data?: unknown): boolean {
    if (event !== COUNT_EVENT) {
      return super.emit(event, data);
    }
    try {
      if (this.useRedis && this.publisherClient) {
        void this.publisherClient.publish(COUNT_CHANNEL, JSON.stringify(data));
        return true;
      }
      return super.emit(event, data);
    } catch (error) {
      logger.warn('Error emitting notification event', { event: String(event), error: errorMessage(error) });
      return super.emit(event, data);
    }
  }

  /** Cierre ordenado: lo llama src/server.ts al apagar. */
  async close() {
    try {
      if (this.subscriberClient) {
        await this.subscriberClient.unsubscribe(COUNT_CHANNEL);
        await this.subscriberClient.quit();
      }
      logger.info('NotificationEmitter closed successfully');
    } catch (error) {
      logger.warn('Error closing NotificationEmitter', { error: errorMessage(error) });
    }
  }
}

export default new NotificationEmitter();
