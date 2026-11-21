// shared/utils/device-blocklist.util.ts
//
// Gestiona la blocklist de dispositivos en Redis.
//
// Propósito:
//   Los access tokens (JWT RS256 propios) son stateless — una vez emitidos son válidos
//   hasta que expiran (~1h) aunque el dispositivo sea bloqueado en BD.
//   Esta utilidad permite invalidación inmediata escribiendo en Redis al momento
//   del bloqueo, y verificando en cada request autenticado.
//
// Convención de clave:
//   device:blocked:{userId}:{fingerprintHash}
//   TTL = segundos restantes del access token al momento de bloquear
//         (si no se conoce el exp del token, se usa 1h por defecto)
//
// Política de fallo (fail-open):
//   Si Redis no está disponible, las operaciones de lectura retornan false
//   y las de escritura fallan silenciosamente (se loguea el error).
//   → Un dispositivo bloqueado con Redis caído podrá operar hasta que
//     su token expire naturalmente. Aceptable vs. cortar disponibilidad.

import redisClient from '../../../shared/infra/redis.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;

const KEY_PREFIX = 'device:blocked';
const DEFAULT_TTL_SECS = 3600; // 1 hora — TTL máximo de un access token

class DeviceBlocklistUtil {
  // ============================================================
  // ESCRITURA
  // ============================================================

  /**
   * Marca un dispositivo como bloqueado en Redis.
   * Llamar justo después de actualizar el status en BD.
   *
   * @param {string} userId           - ID del usuario dueño del dispositivo
   * @param {string} fingerprintHash  - Hash del fingerprint del dispositivo
   * @param {number} [tokenExp]       - Unix timestamp (segundos) de expiración del
   *                                    access token actual del dispositivo.
   *                                    Si no se conoce, se usa DEFAULT_TTL_SECS.
   * @returns {Promise<boolean>} true si se guardó, false si Redis no está disponible
   */
  static async block(userId: string, fingerprintHash: string, tokenExp: number | null = null): Promise<boolean> {
    const key = DeviceBlocklistUtil._buildKey(userId, fingerprintHash);
    const ttl = DeviceBlocklistUtil._computeTtl(tokenExp);

    const ok = await redisClient.set(key, '1', ttl);

    if (ok) {
      logger.info('DeviceBlocklist: dispositivo bloqueado en Redis', {
        userId,
        fingerprintHash,
        ttl
      });
    } else {
      // Redis caído — logueamos para que ops sepa que la invalidación inmediata
      // no está activa. El dispositivo quedará bloqueado en BD y el token
      // expirará naturalmente.
      logger.warn('DeviceBlocklist: Redis no disponible — bloqueo solo en BD', {
        userId,
        fingerprintHash,
        ttl
      });
    }

    return ok;
  }

  /**
   * Elimina el bloqueo de un dispositivo en Redis.
   * Llamar al momento de desbloquear (unblock) un dispositivo.
   *
   * @param {string} userId
   * @param {string} fingerprintHash
   * @returns {Promise<boolean>} true si se eliminó o no existía, false si hubo error
   */
  static async unblock(userId: string, fingerprintHash: string) {
    const key = DeviceBlocklistUtil._buildKey(userId, fingerprintHash);
    const result = await redisClient.del(key);

    logger.info('DeviceBlocklist: dispositivo desbloqueado en Redis', {
      userId,
      fingerprintHash,
      deleted: result > 0
    });

    return true;
  }

  // ============================================================
  // LECTURA
  // ============================================================

  /**
   * Verifica si un dispositivo está en la blocklist.
   *
   * Fail-open: si Redis no está disponible retorna false
   * (el request pasa) — prioriza disponibilidad sobre seguridad estricta.
   *
   * @param {string} userId
   * @param {string} fingerprintHash
   * @returns {Promise<boolean>} true = bloqueado, false = libre o Redis caído
   */
  static async isBlocked(userId: string, fingerprintHash: string) {
    if (!redisClient.isAvailable()) {
      return false; // fail-open
    }

    const key = DeviceBlocklistUtil._buildKey(userId, fingerprintHash);
    const exists = await redisClient.exists(key);
    return exists > 0;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  static _buildKey(userId: string, fingerprintHash: string) {
    return `${KEY_PREFIX}:${userId}:${fingerprintHash}`;
  }

  /**
   * Calcula el TTL en segundos.
   * Si se provee tokenExp (unix seconds), usa el tiempo restante del token.
   * Nunca retorna un TTL menor a 60 segundos (margen mínimo).
   * Si no hay tokenExp o ya expiró, usa DEFAULT_TTL_SECS.
   *
   * @private
   */
  static _computeTtl(tokenExp: number | null | undefined): number {
    if (!tokenExp) {
      return DEFAULT_TTL_SECS;
    }

    const nowSecs = Math.floor(Date.now() / 1000);
    const remaining = tokenExp - nowSecs;
    const MIN_TTL = 60;

    return remaining > MIN_TTL ? remaining : DEFAULT_TTL_SECS;
  }
}

export default DeviceBlocklistUtil;
