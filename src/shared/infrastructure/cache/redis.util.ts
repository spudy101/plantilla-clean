import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import { auditInfraEvent } from '../observability/audit-hook';
import { runOperation } from '../observability/operation';
import constantsModule from '../config';
const { redis: redisConfig } = constantsModule;
import errorMessageModule from '../../kernel/error-message.util';

const { errorMessage } = errorMessageModule;


const REDIS_KEY_NOT_EXISTS = -2;
const REDIS_MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

class RedisClient {
  client: Redis | null = null;
  isConnected = false;
  isEnabled = false;
  // Guard para auditar la caída de Redis una sola vez por incidente.
  private _outageAudited = false;

  _buildConnectionConfig(): string | RedisOptions {
    return redisConfig.url
      ? redisConfig.url
      : {
          host: redisConfig.host,
          port: redisConfig.port,
          password: redisConfig.password || undefined,
          db: redisConfig.db
        };
  }

  _registerClientEvents(): void {
    const { client } = this;
    if (!client) {
      return;
    }
    client.on('ready', () => {
      logger.info('Redis connected', {
        host: redisConfig.host,
        port: redisConfig.port,
        db: redisConfig.db
      });
      this._auditRedisRestored();
      this.isConnected = true;
      this.isEnabled = true;
    });

    client.on('error', (err: Error) => {
      logger.warn('Redis error — falling back to local cache', { error: err.message });
      this._auditRedisOutage('error', err.message);
      this.isConnected = false;
      this.isEnabled = false;
    });

    client.on('close', () => {
      logger.warn('Redis connection closed');
      this._auditRedisOutage('close', null);
      this.isConnected = false;
    });

    client.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }

  /**
   * Audita la caída de Redis en la transición conectado→caído, una sola vez por
   * incidente. Solo emite si veníamos conectados (isConnected === true), de modo
   * que un fallo de conexión en el arranque no genere una alerta espuria.
   * La auditoría no depende de Redis (escribe en BD), por lo que es seguro aquí.
   *
   * @private
   */
  _auditRedisOutage(source: string, reason: string | null): void {
    if (!this.isConnected || this._outageAudited) {
      return;
    }
    this._outageAudited = true;
    logger.error('Redis no disponible — modo degradado activado', { source, error: reason });
    void runOperation({ source: 'system', name: 'redis.outage' }, () =>
      auditInfraEvent({
        action: 'REDIS_CONNECTION_LOST',
        actorId: 'system',
        details: { source, error: reason ?? undefined },
        outcome: 'failure',
        entityType: 'RedisConnection'
      })
    );
  }

  /**
   * Audita la recuperación de Redis en la transición caído→conectado, solo si
   * veníamos de un incidente previamente auditado.
   *
   * @private
   */
  _auditRedisRestored(): void {
    if (!this._outageAudited) {
      return;
    }
    this._outageAudited = false;
    logger.info('Redis reconectado tras incidente');
    void runOperation({ source: 'system', name: 'redis.restored' }, () =>
      auditInfraEvent({ action: 'REDIS_CONNECTION_RESTORED', actorId: 'system', entityType: 'RedisConnection' })
    );
  }

  async connect(): Promise<Redis | null> {
    if (!redisConfig.enabled) {
      logger.info('Redis not configured — running with local cache');
      return null;
    }

    try {
      const options: RedisOptions = {
        retryStrategy: (times: number) => {
          if (times > REDIS_MAX_RETRIES) {
            logger.warn('Redis — max retries reached, disabling');
            this.isEnabled = false;
            return null;
          }
          return Math.min(times * 100, RETRY_DELAY_MS);
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        enableOfflineQueue: false,
        lazyConnect: true
      };
      const connection = this._buildConnectionConfig();
      const client = typeof connection === 'string' ? new Redis(connection, options) : new Redis({ ...connection, ...options });
      this.client = client;

      this._registerClientEvents();

      await client.connect();
      await client.ping();

      this.isEnabled = true;
      return client;
    } catch (error) {
      logger.warn('Redis connection failed — falling back to local cache', {
        error: errorMessage(error)
      });
      this.isEnabled = false;
      this.isConnected = false;
      this.client = null;
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.quit();
      this.isConnected = false;
      this.isEnabled = false;
      logger.info('Redis disconnected');
    } catch (error) {
      logger.error('Redis disconnect error', { error: errorMessage(error) });
    }
  }

  /** @returns {import('ioredis').Redis|null} */
  getClient(): Redis | null {
    return this.isAvailable() ? this.client : null;
  }

  /** @returns {boolean} */
  /** Type guard: si devuelve true, `this.client` no es null. */
  isAvailable(): this is this & { client: Redis } {
    return this.isEnabled && this.isConnected && this.client !== null;
  }

  // ==============================================
  // OPERACIONES — API compatible con cache.util.js
  // ==============================================

  async set(key: string, value: unknown, ttl: number | null = null): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttl) {
        await this.client.set(key, serialized, 'EX', ttl);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.error('Redis SET error', { key, error: errorMessage(error) });
      this.isEnabled = false;
      return false;
    }
  }

  /** Devuelve el JSON parseado (o el string plano si no es JSON). El llamador conoce la forma: `get<T>()`. */
  async get<T = unknown>(key: string): Promise<T | null> {
    if (!this.isAvailable()) {
      return null;
    }
    try {
      const value = await this.client.get(key);
      if (!value) {
        return null;
      }
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as T; // Retorna string plano si no es JSON
      }
    } catch (error) {
      logger.error('Redis GET error', { key, error: errorMessage(error) });
      this.isEnabled = false;
      return null;
    }
  }

  /**
   * Suma `amount` al contador `key` de forma atómica (INCRBY: seguro entre instancias) y le pone TTL.
   * Devuelve el total tras sumar, o null si Redis no está disponible o falla.
   */
  async incrBy(key: string, amount: number, ttlSeconds: number): Promise<number | null> {
    if (!this.isAvailable()) {
      return null;
    }
    try {
      const results = await this.client.multi().incrby(key, amount).expire(key, ttlSeconds).exec();
      const total = results?.[0]?.[1];
      return typeof total === 'number' ? total : null;
    } catch (error) {
      logger.error('Redis INCRBY error', { key, error: errorMessage(error) });
      this.isEnabled = false;
      return null;
    }
  }

  async del(key: string | string[]): Promise<number> {
    if (!this.isAvailable()) {
      return 0;
    }
    try {
      return await (Array.isArray(key) ? this.client.del(...key) : this.client.del(key));
    } catch (error) {
      logger.error('Redis DEL error', { key, error: errorMessage(error) });
      this.isEnabled = false;
      return 0;
    }
  }

  async exists(key: string): Promise<number> {
    if (!this.isAvailable()) {
      return 0;
    }
    try {
      return await this.client.exists(key);
    } catch (error) {
      logger.error('Redis EXISTS error', { key, error: errorMessage(error) });
      this.isEnabled = false;
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<number | false> {
    if (!this.isAvailable()) {
      return false;
    }
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error('Redis EXPIRE error', { key, error: errorMessage(error) });
      this.isEnabled = false;
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.isAvailable()) {
      return REDIS_KEY_NOT_EXISTS;
    }
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis TTL error', { key, error: errorMessage(error) });
      this.isEnabled = false;
      return REDIS_KEY_NOT_EXISTS;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.isAvailable()) {
      return [];
    }
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Redis KEYS error', { pattern, error: errorMessage(error) });
      this.isEnabled = false;
      return [];
    }
  }

  async flush(): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }
    try {
      await this.client.flushdb();
      return true;
    } catch (error) {
      logger.error('Redis FLUSH error', { error: errorMessage(error) });
      this.isEnabled = false;
      return false;
    }
  }
}

export default Object.assign(new RedisClient(), { RedisClient });
