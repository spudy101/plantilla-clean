// modules/shared-endpoints/kyc/iam/services/auth-login/token-refresh.service.ts
//
// Rotación de refresh tokens (RF-AUTH-02): detección de reuse attack y tope
// absoluto de vida de la sesión. Extraído de AuthLoginService (SOLID: S).

import crypto from 'node:crypto';
import userRepository from '../../repositories/user.repository';
import userSessionRepository from '../../repositories/user-session.repository';
import JwtUtil from '../../../../shared/infrastructure/security/jwt.util';
import RefreshTokenStore from '../../utils/refresh-token-store.util';
import TokenBlacklistUtil from '../../utils/token-blacklist.util';
import redisClient from '../../../../shared/infrastructure/cache/redis.util';
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { SECURITY, AUTH_ERROR_CODES, jwt: jwtConfig } = constantsModule;
import auditModule from '../../../audit';
const { audit } = auditModule;

class TokenRefreshService {
  userRepository: typeof userRepository;
  userSessionRepository: typeof userSessionRepository;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   AuthLoginService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: TokenRefreshService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
  }

  /**
   * Renueva un access token usando un refresh token RS256 válido.
   * El refresh token se rota: el JTI anterior se revoca y se emite uno nuevo.
   *
   * Detección de reuse attack:
   *   Si el JWT tiene firma válida pero el JTI ya no está en Redis, significa
   *   que el token ya fue usado (por el usuario legítimo o un atacante).
   *   Respuesta: invalidar todas las sesiones del usuario.
   */
  // [RF-AUTH-02] | CA-01 | Rotación de refresh token con detección de reuse attack.
  // Tope absoluto de sesión: la rotación NO resetea la vida de la sesión. En cada refresh se
  // verifica started_at + ABSOLUTE_SESSION_LIFETIME_HOURS (8h) y se rechaza si se superó,
  // aunque el usuario siga activo (Circular 052/2007 SFC).
  async refreshToken(refreshTokenStr: string) {
    // 1. Verificar firma RS256 y expiración
    const decoded = await JwtUtil.verifyRefreshToken(refreshTokenStr);

    // 1b. Ventana de gracia — ANTES de la blacklist y del check de JTI, porque la rotación deja el
    //     token viejo marcado en ambos lugares y una llamada concurrente moriría antes de llegar acá.
    //     El front web dispara varias llamadas a la vez y, con el access recién vencido, todas piden
    //     refresh con la MISMA cookie: solo la primera rota, y sin esta ventana el resto se
    //     interpretaba como reuse attack (que cierra TODAS las sesiones del usuario). Se devuelve el
    //     par ya emitido: una sola rotación y todas las llamadas coherentes.
    //     No abre un agujero: la clave solo existe si NOSOTROS rotamos ese JTI hace <60s. Un logout
    //     blacklistea el token pero no escribe esta clave, así que ahí no hay gracia que valga.
    const rotated = await RefreshTokenStore.getRotation(decoded.jti);
    if (rotated) {
      logger.info('Refresh concurrente dentro de la ventana de gracia — se reusa el par emitido', {
        userId: decoded.userId,
        jti: decoded.jti
      });
      return rotated;
    }

    // 2. Verificar blacklist individual (logout de esta sesión)
    const isBlacklisted = await TokenBlacklistUtil.isRefreshTokenBlacklisted(refreshTokenStr);
    if (isBlacklisted) {
      throw AppError.unauthorized('La sesión ha expirado. Por favor inicia sesión nuevamente.', {
        code: AUTH_ERROR_CODES.SESSION_CLOSED
      });
    }

    // 3. Verificar invalidación global (logout-all / reuse attack). Se compara contra el iat del
    //    refresh token: un login posterior al evento emite tokens nuevos que deben poder renovar.
    const hasGlobalInvalidation = await TokenBlacklistUtil.isUserSessionsInvalidated(decoded.userId, decoded.iat);
    if (hasGlobalInvalidation) {
      throw AppError.unauthorized('La sesión ha expirado. Por favor inicia sesión nuevamente.', {
        code: AUTH_ERROR_CODES.SESSION_CLOSED
      });
    }

    // 4. Verificar JTI en Redis — detectar reuse attack
    const storedUserId = await RefreshTokenStore.exists(decoded.jti);
    if (!storedUserId) {
      // 4a. Redis caído ≠ token robado. exists() devuelve null en ambos casos; sin esta
      //     distinción, cada parpadeo de Redis cerraría todas las sesiones del usuario.
      //     Fail-open: se deja pasar la rotación (misma política que DeviceBlocklistUtil).
      if (!redisClient.isAvailable()) {
        logger.warn('Refresh sin verificación de JTI — Redis no disponible', {
          userId: decoded.userId,
          jti: decoded.jti
        });
      } else {
        // 4b. JTI ausente, Redis sano y fuera de la ventana de gracia (1b) → reuse real.
        return this._handleRefreshReuseAttack(decoded);
      }
    }

    // 5. Cargar usuario de BD (con rol para que generateAccessToken incluya roleId/roleName)
    const user = await this.userRepository.findByIdWithRole(decoded.userId);
    if (!user || !user.isActive) {
      throw AppError.unauthorized('Usuario no encontrado o inactivo', { code: AUTH_ERROR_CODES.SESSION_CLOSED });
    }

    // 5b. Tope absoluto de sesión: la rotación del refresh no puede extender la sesión más
    //     allá de started_at + 8h. Aplica a clientes e internos por igual.
    if (decoded.sessionId) {
      await this._enforceAbsoluteSessionLifetime(decoded.sessionId, decoded.userId, decoded.jti);
    }

    // 6. Revocar el JTI actual (atomic: antes de emitir el nuevo)
    await RefreshTokenStore.revoke(decoded.jti);

    // 7. Emitir nuevos tokens (conservando el sessionId de la sesión original)
    //    refreshTs marca el momento de la rotación: cualquier token de esta sesión con iat
    //    anterior queda invalidado (con efecto diferido por la gracia) y prevalece el nuevo.
    const refreshTs = Math.floor(Date.now() / 1000);
    const newJti = crypto.randomUUID();
    const newAccessToken = await JwtUtil.generateAccessToken(user, decoded.sessionId);
    const newRefreshToken = await JwtUtil.generateRefreshToken(decoded.userId, newJti, decoded.sessionId);

    // 8. Guardar el nuevo JTI (awaited — si falla, el nuevo refresh token es inútil)
    const saved = await RefreshTokenStore.save(newJti, decoded.userId);
    if (!saved) {
      // Revertir: el viejo JTI ya fue revocado, no podemos revertirlo
      // El usuario deberá hacer login de nuevo
      throw AppError.internal('Error al renovar la sesión. Por favor inicia sesión nuevamente.');
    }

    // 9. Efectos de la rotación: matar el refresh viejo, correr el umbral de la sesión y
    //    actualizar la fila en BD. Todos fire-and-forget.
    this._applyRotationSideEffects(decoded, { refreshTokenStr, refreshTs, newJti });

    await audit.record('TOKEN_REFRESHED', {
      actorId: decoded.userId,
      details: { jti: decoded.jti, newJti },
      entityId: decoded.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const tokens = {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: jwtConfig.accessTokenExpiry
    };

    // 11. Abrir la ventana de gracia (awaited): durante los próximos
    //     SECURITY.REFRESH_ROTATION_GRACE_SECONDS, cualquier llamada concurrente que llegue con el
    //     JTI que acabamos de consumir recibe ESTE mismo par en vez de disparar un reuse attack.
    //     Se espera a propósito — si se resolviera después de responder, la ráfaga que viene atrás
    //     encontraría la ventana todavía vacía, que es justo el caso que esto evita.
    await RefreshTokenStore.saveRotation(decoded.jti, tokens);

    return tokens;
  }

  /**
   * Efectos secundarios de una rotación de refresh ya consumada. Todos fire-and-forget: el par
   * nuevo ya es válido y ninguno de estos pasos debe poder tumbar la renovación.
   *
   * @param {Object} decoded - payload del refresh token consumido
   * @param {{refreshTokenStr: string, refreshTs: number, newJti: string}} rotation
   * @private
   */
  _applyRotationSideEffects(
    decoded: JwtUtil.RefreshClaims,
    { refreshTokenStr, refreshTs, newJti }: { refreshTokenStr: string; refreshTs: number; newJti: string }
  ) {
    // El refresh viejo deja de servir de inmediato.
    TokenBlacklistUtil.blacklistRefreshToken(refreshTokenStr).catch(err =>
      logger.warn('Error añadiendo refresh token expirado a blacklist', { error: err.message })
    );

    if (!decoded.sessionId) {
      return;
    }

    // Invalida el access token anterior de esta sesión — prevalece el nuevo. El umbral es DIFERIDO
    // (misma duración que la ventana de gracia, pero contada sobre la hora del request, no sobre el
    // iat): al rotar de forma proactiva siempre hay requests en vuelo con la cookie vieja, y un
    // margen por iat no los salvaba nunca — el access anterior tiene un iat de minutos atrás, así
    // que moría al instante y esos requests caían con "sesión cerrada", que el front lee como logout.
    TokenBlacklistUtil.invalidateSessionTokensOnRotation(decoded.sessionId, refreshTs).catch(err =>
      logger.warn('Error invalidando access token anterior tras refresh', {
        error: err.message,
        sessionId: decoded.sessionId
      })
    );

    // Rota el JTI en BD y marca actividad (last_access_at).
    this.userSessionRepository.updateJtiAndLastAccess(decoded.sessionId, newJti).catch(err =>
      logger.warn('Error actualizando JTI de sesión en BD', {
        error: err.message,
        sessionId: decoded.sessionId
      })
    );
  }

  /**
   * Reuse attack confirmado: firma válida, JTI ausente, Redis sano y fuera de la ventana de gracia.
   * El token ya fue consumido y alguien lo está reusando → se cierran TODAS las sesiones del usuario
   * (decisión del dev, 2026-07-22: ante un ataque real se cierra todo).
   *
   * Antes de eso descarta el falso positivo más caro: una sesión **cerrada legítimamente** (logout
   * desde otro dispositivo, revocación del admin, worker de inactividad) también deja su JTI
   * revocado. Si el front intentaba renovar sin saberlo, se leía como ataque y la revocación de UNA
   * sesión terminaba tumbando TODAS las del usuario. Con la sesión cerrada en BD, la respuesta
   * correcta es un 401 normal.
   *
   * @private
   */
  // [RF-AUTH-02] | CA-01 | Reuse attack → invalidación global de las sesiones del usuario
  // Siempre lanza (401 de sesión cerrada o de sesión comprometida)
  async _handleRefreshReuseAttack(decoded: JwtUtil.RefreshClaims): Promise<never> {
    if (decoded.sessionId) {
      const session = await this.userSessionRepository.findById(decoded.sessionId);
      if (session && session.status !== 'active') {
        logger.info('Refresh sobre sesión ya cerrada — no es reuse attack', {
          userId: decoded.userId,
          sessionId: decoded.sessionId,
          closeReason: session.closeReason
        });
        throw AppError.unauthorized('La sesión ha sido cerrada. Por favor inicia sesión nuevamente.', {
          code: AUTH_ERROR_CODES.SESSION_CLOSED
        });
      }
    }

    logger.warn('Reuse attack detectado — invalidando todas las sesiones', {
      userId: decoded.userId,
      jti: decoded.jti
    });

    // Evento forense de seguridad (Opción A): incidente distinto de "el request falló".
    // Se mantiene aunque la ruta declare TOKEN_REFRESHED y el middleware loguee el fallo.
    await audit.record('REFRESH_TOKEN_REUSE_ATTACK', {
      actorId: decoded.userId,
      details: { jti: decoded.jti },
      entityId: decoded.userId,
      entityType: 'User',
      entityTable: 'users',
      outcome: 'failure'
    });

    TokenBlacklistUtil.invalidateUserSessions(decoded.userId).catch(err =>
      logger.warn('Error invalidando sesiones tras reuse attack', { error: err.message })
    );

    throw AppError.unauthorized('Sesión comprometida. Por favor inicia sesión nuevamente.', {
      code: AUTH_ERROR_CODES.SESSION_COMPROMISED
    });
  }

  // [RF-AUTH-02] | CA-01 | Tope absoluto de vida de la sesión. Se llama en cada refresh:
  // la rotación del refresh token no puede extender la sesión más allá de started_at + 8h.
  // Cierra la sesión, revoca el JTI, blacklista y lanza 401 si se superó el límite.
  async _enforceAbsoluteSessionLifetime(sessionId: string, userId: string, jti: string) {
    const session = await this.userSessionRepository.findById(sessionId);
    if (!session || session.status !== 'active') {
      return;
    }
    const lifetimeMs = SECURITY.ABSOLUTE_SESSION_LIFETIME_HOURS * 60 * 60 * 1000;
    const expiresAt = new Date(session.startedAt).getTime() + lifetimeMs;
    if (Date.now() < expiresAt) {
      return;
    }

    await this.userSessionRepository.closeSession(sessionId, 'absolute_lifetime');
    RefreshTokenStore.revoke(jti).catch(err =>
      logger.warn('Error revocando JTI al expirar sesión por tope absoluto', { error: err.message, sessionId })
    );
    TokenBlacklistUtil.blacklistSession(sessionId).catch(err =>
      logger.warn('Error invalidando sesión en blacklist por tope absoluto', { error: err.message, sessionId })
    );
    await audit.record('SESSION_ABSOLUTE_EXPIRED', {
      actorId: userId,
      details: { startedAt: session.startedAt, limitHours: SECURITY.ABSOLUTE_SESSION_LIFETIME_HOURS },
      entityId: sessionId,
      entityType: 'UserSession',
      entityTable: 'user_sessions'
    });
    throw AppError.unauthorized('La sesión alcanzó su duración máxima (8 horas). Por favor inicia sesión nuevamente.', {
      code: AUTH_ERROR_CODES.SESSION_ABSOLUTE_LIFETIME
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace TokenRefreshService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    userSessionRepository?: typeof userSessionRepository;
  }
}

export default TokenRefreshService;
