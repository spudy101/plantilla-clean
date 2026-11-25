// Adaptador del puerto UnreadCountChannel: avisa a los streams SSE abiertos que cambió el contador de no leídas
// de un usuario (o de todos, en una global). Con Redis, el aviso viaja por Pub/Sub y llega a todas las
// instancias; sin Redis, queda en la instancia local (EventEmitter).
import EventEmitter from 'node:events';
import type { Redis } from 'ioredis';
import redisClient from '../../../../shared/infrastructure/cache/redis.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { UnreadCountChannel, UnreadCountEvent } from '../../application/ports/runtime.port';

const { logger } = loggerUtilModule;
const { errorMessage } = errorMessageModule;

const COUNT_EVENT = 'count-updated';
const COUNT_CHANNEL = 'notification:count-updated';

export class UnreadCountEmitter implements UnreadCountChannel {
  private readonly local = new EventEmitter();
  private useRedis = false;
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private initialized = false;

  /** Conecta el Pub/Sub de Redis. Lo llama src/main/server.ts DESPUÉS de conectar Redis. */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    try {
      const client = redisClient.isAvailable() ? redisClient.getClient() : null;
      if (client) {
        this.publisher = client;
        const subscriber = client.duplicate();
        this.subscriber = subscriber;
        await subscriber.connect();
        // ioredis entrega lo publicado por el evento 'message' (el callback de subscribe() solo confirma).
        subscriber.on('message', (channel: string, message: string) => {
          try {
            if (channel === COUNT_CHANNEL) {
              this.local.emit(COUNT_EVENT, JSON.parse(message));
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

  publish(event: UnreadCountEvent): void {
    try {
      if (this.useRedis && this.publisher) {
        void this.publisher.publish(COUNT_CHANNEL, JSON.stringify(event));
        return;
      }
      this.local.emit(COUNT_EVENT, event);
    } catch (error) {
      logger.warn('Error emitting notification event', { event: COUNT_EVENT, error: errorMessage(error) });
      this.local.emit(COUNT_EVENT, event);
    }
  }

  subscribe(listener: (event: UnreadCountEvent | null | undefined) => void): () => void {
    this.local.on(COUNT_EVENT, listener);
    return () => {
      this.local.off(COUNT_EVENT, listener);
    };
  }

  listenerCount(): number {
    return this.local.listenerCount(COUNT_EVENT);
  }

  transport(): 'redis' | 'local' {
    return this.useRedis ? 'redis' : 'local';
  }

  /** Cierre ordenado: lo llama src/main/server.ts al apagar. */
  async close(): Promise<void> {
    try {
      if (this.subscriber) {
        await this.subscriber.unsubscribe(COUNT_CHANNEL);
        await this.subscriber.quit();
      }
      logger.info('NotificationEmitter closed successfully');
    } catch (error) {
      logger.warn('Error closing NotificationEmitter', { error: errorMessage(error) });
    }
  }
}
