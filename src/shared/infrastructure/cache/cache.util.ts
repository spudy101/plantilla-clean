import NodeCache from 'node-cache';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../kernel/error-message.util';

const { errorMessage } = errorMessageModule;


/**
 * Caché en memoria local.
 * Se usa como fallback cuando Redis no está disponible.
 * La API es intencionalmente compatible con redis.util.js.
 */
class LocalCache {
  private readonly cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 0, // Sin TTL por defecto (se pasa en cada set)
      checkperiod: 600, // Limpieza automática cada 10 minutos
      useClones: false
    });
  }

  /**
   * @param {string} key
   * @param {any} value
   * @param {number} ttl - Segundos (0 = sin expiración)
   * @returns {boolean}
   */
  set(key: string, value: unknown, ttl = 0) {
    try {
      return this.cache.set(key, value, ttl);
    } catch (error) {
      logger.error('LocalCache SET error', { key, error: errorMessage(error) });
      return false;
    }
  }

  /**
   * @param {string} key
   * @returns {any|null}
   */
  get(key: string) {
    try {
      const value = this.cache.get(key);
      return value === undefined ? null : value;
    } catch (error) {
      logger.error('LocalCache GET error', { key, error: errorMessage(error) });
      return null;
    }
  }

  /**
   * @param {string} key
   * @returns {number} Cantidad de keys eliminadas
   */
  del(key: string) {
    try {
      return this.cache.del(key);
    } catch (error) {
      logger.error('LocalCache DEL error', { key, error: errorMessage(error) });
      return 0;
    }
  }

  /**
   * @param {string} key
   * @returns {number} 1 si existe, 0 si no
   */
  exists(key: string) {
    try {
      return this.cache.has(key) ? 1 : 0;
    } catch (error) {
      logger.error('LocalCache EXISTS error', { key, error: errorMessage(error) });
      return 0;
    }
  }

  /**
   * Busca keys que coincidan con un patrón estilo Redis (soporta wildcard *).
   * @param {string} pattern - Ej: "lock:user:*"
   * @returns {string[]}
   */
  keys(pattern: string) {
    try {
      const allKeys = this.cache.keys();
      const regex = new RegExp(`^${pattern.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll('*', '.*')}$`);
      return allKeys.filter((key: string) => regex.test(key));
    } catch (error) {
      logger.error('LocalCache KEYS error', { pattern, error: errorMessage(error) });
      return [];
    }
  }

  /**
   * Elimina todo el caché en memoria.
   * @returns {boolean}
   */
  flush() {
    try {
      this.cache.flushAll();
      logger.info('LocalCache flushed');
      return true;
    } catch (error) {
      logger.error('LocalCache FLUSH error', { error: errorMessage(error) });
      return false;
    }
  }

  /** @returns {object} Estadísticas internas de node-cache */
  getStats() {
    return this.cache.getStats();
  }
}

export default Object.assign(new LocalCache(), { LocalCache });
