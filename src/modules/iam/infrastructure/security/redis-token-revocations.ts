// Adaptador Redis de la revocación de tokens (puerto TokenRevocations).
//
// === RF-AUTH-02: Login, Gestión de Sesión Segura y Recuperación de Contraseña ===
// === RF-AUTH-03: Gestión de Dispositivos Autenticados y Control de Sesiones ===
// [RF-AUTH-03] | CA-02, CA-04 | Blacklist de tokens en Redis; usado por cierre
// de sesión individual, logout-others y enforcement del límite de 5 sesiones
//
// Gestiona la blacklist de tokens JWT en Redis.
//
// Por qué es necesario:
//   Los JWT RS256 propios se validan localmente con la clave pública (sin ir a BD).
//   Un token ya emitido sigue pasando esa verificación local hasta que expira
//   (~1h para access tokens). Esta utilidad permite invalidación
//   inmediata al momento del logout, sin esperar al TTL natural del JWT.
//
// Convención de claves:
//   token:blacklisted:{sha256hex(accessToken)}
//     Valor: "1" | TTL: segundos restantes del token (min 60s)
//
//   token:refresh:blacklisted:{sha256hex(refreshToken)}
//     Valor: "1" | TTL: 7 días (REFRESH_TTL)
//
//   token:user:invalidated_at:{userId}
//     Valor: unix timestamp (string) | TTL: 24h (USER_INVALIDATION_TTL — vida real del refresh)
//     Indica que TODAS las sesiones del usuario fueron invalidadas (logout-all, reset de
//     contraseña, reuse attack). Se compara SIEMPRE contra el iat del token: los tokens
//     emitidos después del evento son válidos. También se limpia en el login exitoso.
//
//   token:session:invalidated_at:{sessionId}
//     Valor: unix timestamp (string) O "rotation:{unix timestamp}" | TTL: TTL del access token (máx 8h)
//     Umbral de invalidación por sesión: el middleware rechaza los access tokens
//     de esa sesión cuyo iat < timestamp guardado. Permite invalidar tokens sin
//     conocer su valor (solo el sessionId). Dos usos, con semántica distinta:
//       - Cerrar la sesión por completo (otro navegador, límite, re-login mismo
//         dispositivo): valor = ahora+1 (número plano) → efecto INMEDIATO,
//         mueren TODOS los tokens actuales.
//       - Rotación en refresh: valor = "rotation:{momento del refresh}" → efecto
//         DIFERIDO: el umbral solo rechaza pasados REFRESH_ROTATION_GRACE_SECONDS
//         desde la rotación. El access anterior tiene un iat de minutos atrás (el
//         front rota proactivamente), así que un margen sobre el iat no protege
//         nada: la gracia tiene que ser sobre la hora del request, o los requests
//         en vuelo con la cookie vieja mueren con SESSION_CLOSED y el front
//         desloguea (contrato AUTH_ERROR_CODES).
//
// Política de fallo (fail-open):
//   Si Redis no está disponible, las lecturas retornan false y las escrituras
//   fallan silenciosamente. El request pasa — priorizamos disponibilidad.

import crypto from 'node:crypto';
import redisClient from '../../../../shared/infrastructure/cache/redis.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { SECURITY } = constantsModule;

const KEY_ACCESS_PREFIX = 'token:blacklisted';
const KEY_REFRESH_PREFIX = 'token:refresh:blacklisted';
const KEY_USER_PREFIX = 'token:user:invalidated_at';
const KEY_SESSION_PREFIX = 'token:session:invalidated_at';
const SESSION_ROTATION_VALUE_PREFIX = 'rotation:';

const DEFAULT_ACCESS_TTL = 28800; // 8 horas — igual al TTL del access token RS256
const REFRESH_TTL = 604800; // 7 días — blacklist por valor de refresh tokens concretos
const USER_INVALIDATION_TTL = 86400; // 24h — vida real del refresh token (exp del JWT y TTL del JTI)
const MIN_TTL = 60; // margen mínimo para evitar claves con TTL ínfimo

// [RF-AUTH-02] | CA-02 | Blacklist de tokens por SHA-256 en Redis. TTL = expiración natural del token
class TokenBlacklistUtil {
  // ============================================================
  // ESCRITURA
  // ============================================================

  /**
   * Añade un access token a la blacklist.
   * Fire-and-forget: llama sin await y captura errores con .catch().
   *
   * @param {string} accessToken
   * @param {number} [tokenExp] - Unix timestamp (segundos) de expiración del token
   */
  static async blacklistAccessToken(accessToken: string | null | undefined, tokenExp: number | null = null) {
    if (!accessToken) {
      return false;
    }

    const key = `${KEY_ACCESS_PREFIX}:${TokenBlacklistUtil._hash(accessToken)}`;
    const ttl = TokenBlacklistUtil._computeAccessTtl(tokenExp);
    const ok = await redisClient.set(key, '1', ttl);

    if (ok) {
      logger.info('TokenBlacklist: access token añadido a blacklist', { ttl });
    } else {
      logger.warn('TokenBlacklist: Redis no disponible — access token no invalidado en Redis', {
        ttl
      });
    }

    return ok;
  }

  /**
   * Añade un refresh token a la blacklist.
   * Fire-and-forget: llama sin await y captura errores con .catch().
   *
   * @param {string} refreshToken
   */
  static async blacklistRefreshToken(refreshToken: string) {
    if (!refreshToken) {
      return false;
    }

    const key = `${KEY_REFRESH_PREFIX}:${TokenBlacklistUtil._hash(refreshToken)}`;
    const ok = await redisClient.set(key, '1', REFRESH_TTL);

    if (ok) {
      logger.info('TokenBlacklist: refresh token añadido a blacklist');
    } else {
      logger.warn('TokenBlacklist: Redis no disponible — refresh token no invalidado en Redis');
    }

    return ok;
  }

  /**
   * Invalida TODOS los access tokens actuales de una sesión (cierre completo).
   * Guarda un umbral = ahora+1, de modo que cualquier token con iat <= ahora queda
   * rechazado por el middleware. Usar al cerrar OTRA sesión (otro navegador, límite
   * de sesiones, re-login del mismo dispositivo), cuando no se dispone del valor del
   * access token de esa sesión.
   * Fire-and-forget: llamar sin await y capturar errores con .catch().
   *
   * @param {string} sessionId
   */
  static blacklistSession(sessionId: string) {
    const threshold = Math.floor(Date.now() / 1000) + 1;
    return TokenBlacklistUtil.invalidateSessionTokensBefore(sessionId, threshold);
  }

  /**
   * Invalida los access tokens de una sesión cuyo iat sea anterior a `beforeIat`.
   * Usar en la rotación de refresh: tras emitir el token nuevo, los anteriores de la
   * MISMA sesión dejan de servir y prevalece el nuevo (su iat >= beforeIat).
   * Fire-and-forget: llamar sin await y capturar errores con .catch().
   *
   * @param {string} sessionId
   * @param {number} beforeIat - Unix timestamp (segundos): umbral de invalidación
   */
  static async invalidateSessionTokensBefore(sessionId: string, beforeIat: number) {
    if (!sessionId || !beforeIat) {
      return false;
    }

    const key = `${KEY_SESSION_PREFIX}:${sessionId}`;
    const ok = await redisClient.set(key, String(beforeIat), DEFAULT_ACCESS_TTL);

    if (ok) {
      logger.info('TokenBlacklist: umbral de invalidación de sesión guardado', {
        sessionId,
        beforeIat
      });
    } else {
      logger.warn('TokenBlacklist: Redis no disponible — sesión no invalidada en Redis', {
        sessionId
      });
    }

    return ok;
  }

  /**
   * Invalida el access token anterior de una sesión tras una rotación de refresh,
   * con efecto DIFERIDO: el umbral (iat < rotationTs) solo empieza a rechazar cuando
   * pasaron SECURITY.REFRESH_ROTATION_GRACE_SECONDS desde la rotación. Los requests
   * que salieron con la cookie vieja alrededor del refresh terminan bien y el token
   * anterior muere igual, unos segundos después (o antes por su propio exp).
   * NO usar para cerrar/revocar una sesión — eso es blacklistSession (inmediato).
   * Fire-and-forget: llamar sin await y capturar errores con .catch().
   *
   * @param {string} sessionId
   * @param {number} rotationTs - Unix timestamp (segundos) del momento de la rotación
   */
  static async invalidateSessionTokensOnRotation(sessionId: string, rotationTs: number) {
    if (!sessionId || !rotationTs) {
      return false;
    }

    const key = `${KEY_SESSION_PREFIX}:${sessionId}`;
    const ok = await redisClient.set(key, `${SESSION_ROTATION_VALUE_PREFIX}${rotationTs}`, DEFAULT_ACCESS_TTL);

    if (ok) {
      logger.info('TokenBlacklist: umbral de rotación de sesión guardado (efecto diferido)', {
        sessionId,
        rotationTs
      });
    } else {
      logger.warn('TokenBlacklist: Redis no disponible — rotación de sesión no registrada en Redis', {
        sessionId
      });
    }

    return ok;
  }

  /**
   * Marca todas las sesiones de un usuario como invalidadas (logout-all).
   * Escribe el timestamp actual — el middleware rechaza tokens con iat <= ese timestamp.
   * Se limpia automáticamente al hacer un login exitoso posterior.
   *
   * @param {string} userId
   */
  static async invalidateUserSessions(userId: string) {
    if (!userId) {
      return false;
    }

    const key = `${KEY_USER_PREFIX}:${userId}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    // TTL = vida real del refresh token (24h), no 7 días: la clave solo tiene sentido mientras
    // pueda existir un token anterior al evento. Sobrevivirle solo agrega superficie para que un
    // chequeo mal hecho (sin comparar iat) bloquee sesiones legítimas creadas después.
    const ok = await redisClient.set(key, timestamp, USER_INVALIDATION_TTL);

    if (ok) {
      logger.info('TokenBlacklist: todas las sesiones del usuario invalidadas en Redis', {
        userId,
        timestamp
      });
    } else {
      logger.warn('TokenBlacklist: Redis no disponible — sesiones de usuario no invalidadas en Redis', { userId });
    }

    return ok;
  }

  /**
   * Elimina la clave de invalidación global del usuario.
   * Llamar al completar un login exitoso para permitir que nuevos tokens funcionen.
   *
   * @param {string} userId
   */
  static async clearUserInvalidation(userId: string) {
    if (!userId) {
      return;
    }
    const key = `${KEY_USER_PREFIX}:${userId}`;
    await redisClient.del(key);
  }

  // ============================================================
  // LECTURA
  // ============================================================

  /**
   * Verifica si un access token está en la blacklist.
   * Fail-open: retorna false si Redis no está disponible.
   *
   * @param {string} accessToken
   * @returns {Promise<boolean>}
   */
  static async isAccessTokenBlacklisted(accessToken: string) {
    if (!accessToken || !redisClient.isAvailable()) {
      return false;
    }

    const key = `${KEY_ACCESS_PREFIX}:${TokenBlacklistUtil._hash(accessToken)}`;
    const exists = await redisClient.exists(key);
    return exists > 0;
  }

  /**
   * Verifica si un access token quedó invalidado por el umbral de su sesión.
   * Dos formatos de valor, con semánticas distintas:
   *   - Número plano (cierre/revocación, blacklistSession): rechazo INMEDIATO si iat < umbral.
   *   - "rotation:{ts}" (rotación de refresh): rechazo DIFERIDO — solo si iat < ts Y ya pasaron
   *     REFRESH_ROTATION_GRACE_SECONDS desde la rotación. La gracia va sobre la hora del request,
   *     no sobre el iat: el access anterior siempre tiene un iat de minutos atrás y un margen por
   *     iat no lo salvaría nunca (tumbaba los requests en vuelo con la cookie vieja).
   * Fail-open: retorna false si Redis no está disponible o no existe la clave.
   *
   * @param {string} sessionId
   * @param {number} tokenIat - Unix timestamp (segundos) del iat del access token
   * @returns {Promise<boolean>} true = token invalidado (iat anterior al umbral)
   */
  static async isSessionTokenInvalidated(sessionId: string | null | undefined, tokenIat: number | undefined): Promise<boolean> {
    if (!sessionId || !tokenIat || !redisClient.isAvailable()) {
      return false;
    }

    const key = `${KEY_SESSION_PREFIX}:${sessionId}`;
    // Valor: '1' (sesión invalidada) o 'rot:<timestamp>' (rotación). Puede venir como número si es JSON.
    const raw = await redisClient.get<string | number>(key);

    if (raw === null || raw === undefined || raw === '') {
      return false;
    }
    const stored = String(raw);

    if (stored.startsWith(SESSION_ROTATION_VALUE_PREFIX)) {
      const rotationTs = Number(stored.slice(SESSION_ROTATION_VALUE_PREFIX.length));
      const nowSec = Math.floor(Date.now() / 1000);
      return tokenIat < rotationTs && nowSec >= rotationTs + SECURITY.REFRESH_ROTATION_GRACE_SECONDS;
    }

    return tokenIat < Number(stored);
  }

  /**
   * Verifica si un refresh token está en la blacklist.
   * Fail-open: retorna false si Redis no está disponible.
   *
   * @param {string} refreshToken
   * @returns {Promise<boolean>}
   */
  static async isRefreshTokenBlacklisted(refreshToken: string) {
    if (!refreshToken || !redisClient.isAvailable()) {
      return false;
    }

    const key = `${KEY_REFRESH_PREFIX}:${TokenBlacklistUtil._hash(refreshToken)}`;
    const exists = await redisClient.exists(key);
    return exists > 0;
  }

  /**
   * Verifica si el token fue emitido antes de un evento logout-all del usuario.
   * Compara tokenIat contra el timestamp almacenado.
   * Fail-open: retorna false si Redis no está disponible o no existe la clave.
   *
   * @param {string} userId
   * @param {number} tokenIat - Unix timestamp (segundos) del iat del token (del ID token)
   * @returns {Promise<boolean>} true = sesión invalidada, false = OK o Redis caído
   */
  static async isUserSessionsInvalidated(userId: string, tokenIat: number | undefined): Promise<boolean> {
    if (!userId || !tokenIat || !redisClient.isAvailable()) {
      return false;
    }

    const key = `${KEY_USER_PREFIX}:${userId}`;
    const invalidated = await redisClient.get(key);

    if (!invalidated) {
      return false;
    }

    return tokenIat <= Number(invalidated);
  }

  /**
   * Verifica si existe una invalidación global para el usuario, **sin comparar el iat**.
   *
   * ⚠️ **No usar.** Se escribió para el refresh cuando los tokens eran opacos (proveedor externo); con JWT
   * propios el refresh sí trae `iat` y debe usarse `isUserSessionsInvalidated`. Sin la comparación,
   * la sola existencia de la clave bloquea también a los tokens emitidos DESPUÉS del evento: tras
   * un logout-all o un reuse attack, el usuario volvía a loguearse y aun así no podía renovar,
   * dependiendo de que un `clearUserInvalidation` fire-and-forget hubiera limpiado la clave.
   *
   * Se conserva solo por compatibilidad; sin llamadores en producción.
   *
   * @deprecated Usar {@link TokenBlacklistUtil.isUserSessionsInvalidated} con el iat del token.
   * @param {string} userId
   * @returns {Promise<boolean>} true = invalidación global activa
   */
  static async hasUserGlobalInvalidation(userId: string) {
    if (!userId || !redisClient.isAvailable()) {
      return false;
    }

    const key = `${KEY_USER_PREFIX}:${userId}`;
    const exists = await redisClient.exists(key);
    return exists > 0;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  static _hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Calcula el TTL del access token en segundos.
   * Usa el tiempo restante si se provee tokenExp.
   * Nunca retorna un TTL menor a MIN_TTL.
   *
   * @private
   */
  static _computeAccessTtl(tokenExp: number | null | undefined): number {
    if (!tokenExp) {
      return DEFAULT_ACCESS_TTL;
    }

    const nowSecs = Math.floor(Date.now() / 1000);
    const remaining = tokenExp - nowSecs;

    return remaining > MIN_TTL ? remaining : DEFAULT_ACCESS_TTL;
  }
}

export default TokenBlacklistUtil;
