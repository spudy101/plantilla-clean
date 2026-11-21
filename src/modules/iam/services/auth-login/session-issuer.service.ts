import type { UserWith } from '../../repositories/user.repository';
// modules/shared-endpoints/kyc/iam/services/auth-login/session-issuer.service.ts
//
// Emisión de una sesión autenticada: par de tokens RS256 propios + JTI en Redis + fila en
// user_sessions. Lo usan el login por contraseña, el biométrico y el login automático
// post-registro (antes el bloque estaba copiado en los tres). Extraído por SOLID: S.

import crypto from 'node:crypto';
import userSessionRepository from '../../repositories/user-session.repository';
import JwtUtil from '../../../../shared/infrastructure/security/jwt.util';
import RefreshTokenStore from '../../utils/refresh-token-store.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { jwt: jwtConfig } = constantsModule;

class SessionIssuerService {
  userSessionRepository: typeof userSessionRepository;
  jwt: typeof JwtUtil;
  refreshTokenStore: typeof RefreshTokenStore;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D).
   */
  constructor(deps: SessionIssuerService.Deps = {}) {
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
    this.jwt = deps.jwt ?? JwtUtil;
    this.refreshTokenStore = deps.refreshTokenStore ?? RefreshTokenStore;
  }

  /**
   * @param {Object} user - usuario con las asociaciones que el access token necesita (rol, persona)
   * @param {{ deviceId?: string|null, ip?: string|null, userAgent?: string|null, source: string }} options
   *   source: etiqueta para los logs (p. ej. 'login', 'login biométrico', 'registro')
   * @returns {Promise<{ sessionId: string, tokens: { accessToken, refreshToken, expiresIn } }>}
   */
  async issue(
    user: UserWith<'login'>,
    {
      deviceId = null,
      ip = null,
      userAgent = null,
      source
    }: { deviceId?: string | null; ip?: string | null; userAgent?: string | null; source: string }
  ) {
    const { userId } = user;
    const sessionId = crypto.randomUUID();
    const jti = crypto.randomUUID();
    const accessToken = await this.jwt.generateAccessToken(user, sessionId);
    const refreshToken = await this.jwt.generateRefreshToken(userId, jti, sessionId);

    // JTI awaited: si falla, el refresh no servirá, pero no bloqueamos la autenticación
    const jtiSaved = await this.refreshTokenStore.save(jti, userId);
    if (!jtiSaved) {
      logger.warn(`No se pudo guardar JTI de refresh token en ${source}`, { userId });
    }

    // [RF-AUTH-02] | CA-04 | Sesión activa con IP, user-agent, started_at y last_access_at (fire-and-forget)
    this.userSessionRepository
      .create({
        userSessionId: sessionId,
        userId,
        deviceId: deviceId || null,
        jti,
        ipAddress: ip || null,
        userAgent: userAgent || null,
        startedAt: new Date(),
        lastAccessAt: new Date()
      })
      .catch(err => logger.warn(`Error creando registro de sesión en BD (${source})`, { error: err.message, userId }));

    return { sessionId, tokens: { accessToken, refreshToken, expiresIn: jwtConfig.accessTokenExpiry } };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace SessionIssuerService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userSessionRepository?: typeof userSessionRepository;
    jwt?: typeof JwtUtil;
    refreshTokenStore?: typeof RefreshTokenStore;
  }
}

export default SessionIssuerService;
