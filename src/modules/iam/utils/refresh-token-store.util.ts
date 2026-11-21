// shared/utils/refresh-token-store.util.ts
//
// === RF-AUTH-02: Login, Gestión de Sesión Segura y Recuperación de Contraseña ===
//
// Gestiona el store Redis de JTIs activos de refresh tokens.
//
// Por qué almacenar los JTIs:
//   Los refresh tokens son JWT RS256 verificables por firma, pero sin estado Redis
//   un token robado podría usarse indefinidamente hasta su expiración (24h).
//   Al registrar cada JTI activo, podemos:
//     1. Invalidar un refresh token específico al hacer logout.
//     2. Detectar reuse attacks: si un JTI ya no existe en Redis pero la firma
//        es válida, significa que alguien lo usó antes que el usuario legítimo.
//
// Convención de claves:
//   refresh:jti:{jti}  →  userId  (string)
//   TTL = 24h (tope absoluto). El JTI normalmente se revoca antes por rotación,
//   logout o el worker de inactividad; el TTL es solo el techo máximo y alinea
//   la caducidad en Redis con el exp del JWT refresh.
//
//   refresh:rotated:{jtiViejo}  →  JSON del par emitido al rotarlo
//   TTL = SECURITY.REFRESH_ROTATION_GRACE_SECONDS (60s). Ventana de gracia: el front web
//   dispara varias llamadas a la vez y, con el access recién vencido, todas piden refresh con
//   la MISMA cookie. Sin esta ventana la segunda en llegar encuentra el JTI ya revocado y se
//   interpreta como reuse attack (que cierra TODAS las sesiones del usuario). Dentro de la
//   ventana se devuelve el par ya emitido — una sola rotación, todas las llamadas coherentes.
//
// Política de fallo:
//   save()        — await obligatorio: si falla, el refresh token no servirá.
//   exists()      — retorna null tanto si el JTI no existe como si Redis está caído; el caller
//                   DEBE distinguir ambos casos con redisClient.isAvailable() antes de declarar
//                   reuse (una caída de Redis no es un token robado).
//   revoke()      — best-effort con log.
//   getRotation() — best-effort: ante error se comporta como "sin gracia" (miss).

import redisClient from '../../../shared/infrastructure/cache/redis.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/infrastructure/config';
const { SECURITY } = constantsModule;
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;


const KEY_PREFIX = 'refresh:jti';
const ROTATED_KEY_PREFIX = 'refresh:rotated';
const TTL_SECS = 86400; // 24h — tope absoluto, igual al exp del JWT refresh

// [RF-AUTH-02] | CA-01 | Almacén de JTIs de refresh tokens en Redis (TTL 24h, ver TTL_SECS) para validar rotación
class RefreshTokenStore {
  // ============================================================
  // ESCRITURA
  // ============================================================

  /**
   * Persiste un JTI de refresh token en Redis.
   * Debe llamarse SIEMPRE con await — si falla, el token emitido no es usable.
   *
   * @param {string} jti    - JTI único del refresh token
   * @param {string} userId - ID del usuario dueño del token
   * @returns {Promise<boolean>} true si se guardó
   * @throws {Error} si Redis no está disponible (el caller decide cómo manejarlo)
   */
  static async save(jti: string, userId: string) {
    const key = RefreshTokenStore._buildKey(jti);
    // TTL de 24h (tope absoluto). Normalmente el JTI se revoca antes por rotación,
    // logout o el worker de inactividad; el TTL solo garantiza que no sobreviva al exp del JWT.
    const ok = await redisClient.set(key, userId, TTL_SECS);

    if (!ok) {
      logger.error('RefreshTokenStore: no se pudo guardar JTI en Redis', { jti, userId });
    }

    return ok;
  }

  /**
   * Elimina un JTI de Redis (el token fue consumido — rotación).
   * Best-effort: el error se loguea pero no se propaga.
   *
   * @param {string} jti
   */
  static async revoke(jti: string) {
    const key = RefreshTokenStore._buildKey(jti);
    const result = await redisClient.del(key);

    if (result === 0) {
      logger.warn('RefreshTokenStore.revoke: JTI no encontrado en Redis (ya revocado?)', { jti });
    }
  }

  /**
   * Registra el resultado de una rotación para la ventana de gracia.
   * Guarda, contra el JTI que se acaba de consumir, el par de tokens emitido en su lugar.
   *
   * Best-effort: si falla, la única consecuencia es que una ráfaga concurrente vuelva a
   * interpretarse como reuse. Se loguea y se sigue.
   *
   * @param {string} oldJti - JTI recién rotado (el que el cliente acaba de consumir)
   * @param {{accessToken: string, refreshToken: string, expiresIn: number}} tokens - par emitido
   * @returns {Promise<boolean>}
   */
  // [RF-AUTH-02] | CA-01 | Ventana de gracia de la rotación — evita el reuse falso por concurrencia
  static async saveRotation(oldJti: string, tokens: RefreshTokenStore.RotatedTokens | null | undefined): Promise<boolean> {
    if (!oldJti || !tokens) {
      return false;
    }

    const key = RefreshTokenStore._buildRotatedKey(oldJti);
    // redisClient serializa el objeto (JSON) y lo parsea al leer: no se hace JSON.stringify aquí.
    const ok = await redisClient.set(key, tokens, SECURITY.REFRESH_ROTATION_GRACE_SECONDS);

    if (!ok) {
      logger.warn('RefreshTokenStore: no se pudo guardar la ventana de gracia de rotación', { jti: oldJti });
    }

    return ok;
  }

  // ============================================================
  // LECTURA
  // ============================================================

  /**
   * Recupera el par de tokens emitido al rotar `oldJti`, si sigue dentro de la ventana de gracia.
   *
   * @param {string} oldJti
   * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: number}|null>}
   *          El par emitido, o null si no hubo rotación reciente / Redis no está disponible.
   */
  static async getRotation(oldJti: string): Promise<RefreshTokenStore.RotatedTokens | null> {
    if (!oldJti || !redisClient.isAvailable()) {
      return null;
    }

    const raw = await redisClient.get<RefreshTokenStore.RotatedTokens | string>(RefreshTokenStore._buildRotatedKey(oldJti));
    if (!raw) {
      return null;
    }
    // redisClient.get ya devuelve el objeto parseado. Antes se hacía JSON.parse(objeto) → siempre
    // lanzaba y la ventana de gracia nunca funcionaba. Se acepta string por compatibilidad con
    // valores guardados con la versión anterior (doble serialización).
    if (typeof raw !== 'string') {
      return raw;
    }

    try {
      return JSON.parse(raw) as RefreshTokenStore.RotatedTokens;
    } catch (error) {
      logger.warn('RefreshTokenStore: ventana de gracia con contenido ilegible', { jti: oldJti, error: errorMessage(error) });
      return null;
    }
  }

  /**
   * Verifica si un JTI sigue activo en Redis.
   *
   * Retorna:
   *   - El userId almacenado → JTI válido
   *   - null                 → JTI no existe (ya consumido o nunca guardado)
   *   - null                 → Redis no disponible
   *
   * ⚠️ Los dos `null` significan cosas opuestas y el caller DEBE separarlos consultando
   * `redisClient.isAvailable()`: con Redis caído se deja pasar la rotación (fail-open,
   * consistente con DeviceBlocklistUtil); tratar esa caída como JTI ausente equivale a
   * declarar reuse attack —y cerrar todas las sesiones del usuario— cada vez que Redis
   * parpadea.
   *
   * @param {string} jti
   * @returns {Promise<string|null>} userId o null
   */
  static async exists(jti: string) {
    if (!redisClient.isAvailable()) {
      logger.warn('RefreshTokenStore.exists: Redis no disponible — omitiendo check de JTI', {
        jti
      });
      return null;
    }

    const key = RefreshTokenStore._buildKey(jti);
    const value = await redisClient.get(key);
    return value || null;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  static _buildKey(jti: string) {
    return `${KEY_PREFIX}:${jti}`;
  }

  /** @private */
  static _buildRotatedKey(jti: string) {
    return `${ROTATED_KEY_PREFIX}:${jti}`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace RefreshTokenStore {
  /** Par de tokens emitido al rotar (se devuelve igual dentro de la ventana de gracia). */
  export interface RotatedTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number | string;
  }
}

export default RefreshTokenStore;
