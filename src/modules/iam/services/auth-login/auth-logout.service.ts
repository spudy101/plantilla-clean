// modules/shared-endpoints/kyc/iam/services/auth-login/auth-logout.service.ts
//
// Cierre de sesión (actual o todas): revoca refresh tokens, blacklista access
// tokens y notifica. Extraído de AuthLoginService (SOLID: S).

import userSessionRepository from '../../repositories/user-session.repository';
import trustedDeviceRepository from '../../repositories/auth-trusted-device.repository';
import TokenBlacklistUtil from '../../utils/token-blacklist.util';
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import loggerUtilModule from '../../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import auditModule from '../../../audit';
const { audit } = auditModule;

class AuthLogoutService {
  userSessionRepository: typeof userSessionRepository;
  trustedDeviceRepository: typeof trustedDeviceRepository;
  notifier: typeof notifier;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   AuthLoginService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: AuthLogoutService.Deps = {}) {
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
    this.trustedDeviceRepository = deps.trustedDeviceRepository ?? trustedDeviceRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  // ============================================================
  // LOGOUT
  // ============================================================

  /**
   * @param {string} userId
   * @param {string} fingerprintHash
   * @param {Object} tokens
   * @param {string} tokens.accessToken   - Access token JWT de la sesión actual
   * @param {number} tokens.tokenExp      - Unix timestamp de expiración del access token
   * @param {string} [tokens.refreshToken] - Refresh token (disponible en web y mobile que lo envíe)
   */
  // [RF-AUTH-02] | CA-02 | Logout individual: blacklistea access y refresh, cierra sesión en BD
  async logout(userId: string, fingerprintHash: string, tokens: AuthLogoutService.RequestTokens = {}) {
    const { accessToken, tokenExp, refreshToken, sessionId } = tokens;

    // Cerrar la sesión en BD
    if (sessionId) {
      this.userSessionRepository.closeSession(sessionId, 'logout').catch(err =>
        logger.warn('Error cerrando sesión en BD en logout', {
          error: err.message,
          userId,
          sessionId
        })
      );
    }

    // Invalidar access token — impide su uso aunque aún no haya expirado
    TokenBlacklistUtil.blacklistAccessToken(accessToken, tokenExp).catch(err =>
      logger.warn('Error añadiendo access token a blacklist en logout', {
        error: err.message,
        userId
      })
    );

    // Invalidar refresh token si está disponible
    if (refreshToken) {
      TokenBlacklistUtil.blacklistRefreshToken(refreshToken).catch(err =>
        logger.warn('Error añadiendo refresh token a blacklist en logout', {
          error: err.message,
          userId
        })
      );
    }

    await this.trustedDeviceRepository
      .updateLastSeen(userId, fingerprintHash)
      .catch(err => logger.warn('Error updating last_seen on logout', { error: err.message }));

    await audit.record('LOGOUT', {
      actorId: userId,
      details: { fingerprintHash },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return null;
  }

  /**
   * @param {string} userId
   * @param {Object} tokens
   * @param {string} tokens.accessToken - Access token JWT de la sesión actual
   * @param {number} tokens.tokenExp    - Unix timestamp de expiración del access token
   */
  // [RF-AUTH-02] | CA-02 | Logout global: invalida todas las sesiones del usuario.
  // Todo el control de sesiones es propio (blacklist + rotación de refresh en Redis/BD),
  // así que basta con invalidar aquí — no hay proveedor externo que sincronizar.
  async logoutAll(userId: string, tokens: AuthLogoutService.RequestTokens = {}) {
    const { accessToken, tokenExp, firstName } = tokens;

    // Invalidar el access token actual en Redis. La invalidación global de más abajo
    // cubre además los access tokens de otras sesiones que aún no hayan expirado.
    TokenBlacklistUtil.blacklistAccessToken(accessToken, tokenExp).catch(err =>
      logger.warn('Error añadiendo access token a blacklist en logout-all', {
        error: err.message,
        userId
      })
    );

    // Marcar todas las sesiones como invalidadas — cubre access tokens de otras
    // sesiones que aún no han expirado y no fueron individualmente blacklisteados
    TokenBlacklistUtil.invalidateUserSessions(userId).catch(err =>
      logger.warn('Error invalidando sesiones de usuario en logout-all', {
        error: err.message,
        userId
      })
    );

    // Cerrar todas las sesiones activas en BD
    this.userSessionRepository
      .closeAllByUser(userId, 'logout_all')
      .catch(err => logger.warn('Error cerrando sesiones en BD en logout-all', { error: err.message, userId }));

    await this.trustedDeviceRepository.deleteAllByUser(userId);

    await audit.record('LOGOUT_ALL', {
      actorId: userId,
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    // Notificar al usuario que todas sus sesiones fueron cerradas (fire-and-forget)
    setImmediate(() => {
      this.notifier.notify({
        type: 'LOGOUT_ALL',
        userId,
        metadata: { nombre: firstName || 'Usuario' }
      }).catch(err => logger.warn('Error enviando notificación logout all', { error: err.message }));
    });

    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AuthLogoutService {
  /** Tokens y datos de la sesión actual que el controller extrae del request. */
  export interface RequestTokens {
    accessToken?: string | null;
    tokenExp?: number | null;
    refreshToken?: string | null;
    sessionId?: string | null;
    firstName?: string | null;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userSessionRepository?: typeof userSessionRepository;
    trustedDeviceRepository?: typeof trustedDeviceRepository;
    notifier?: typeof notifier;
  }
}

export default AuthLogoutService;
