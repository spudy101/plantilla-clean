// Casos de uso del ciclo de vida de la sesión: renovar los tokens (RefreshTokens), cerrar la sesión actual o todas
// (Logout, LogoutAll), cerrar una sesión propia o las demás (CloseOwnSession, CloseOtherSessions).
import { IamInternalError, IamUnauthorizedError, SessionClosedError, AUTH_ERROR_CODES } from '../../domain/errors';
import { exceededAbsoluteLifetime } from '../../domain/session';
import type { IssuedTokens, RefreshClaims } from '../ports/auth-tokens.port';
import type { IamDeps } from './iam-deps';
import type { SessionControl } from './sessions';

// ============================================================
// REFRESH
// ============================================================

type RefreshDeps = Pick<IamDeps, 'users' | 'sessions' | 'tokens' | 'refreshTokens' | 'revocations' | 'cache' | 'random' | 'audit' | 'logger' | 'policy'>;

/**
 * Renueva el access token con un refresh token válido. El refresh se rota: el JTI anterior se revoca y se emite uno
 * nuevo. Si la firma es válida pero el JTI ya no está, el token ya se usó (reuse attack) y se cierran todas las
 * sesiones del usuario.
 *
 * [RF-AUTH-02] | CA-01 | Tope absoluto: la rotación NO resetea la vida de la sesión (started_at + 8h).
 */
export class RefreshTokens {
  constructor(private readonly deps: RefreshDeps) {}

  async execute(refreshTokenStr: string): Promise<IssuedTokens> {
    const { users, tokens, refreshTokens, revocations, cache, random, audit, logger } = this.deps;
    // 1. Firma RS256 y expiración
    const decoded = await tokens.verifyRefreshToken(refreshTokenStr);

    // 1b. Ventana de gracia — ANTES de la blacklist y del JTI: la rotación deja el token viejo marcado en ambos y
    //     una llamada concurrente (el front dispara varias con la misma cookie) moriría antes de llegar acá. Se
    //     devuelve el par ya emitido. Un logout blacklistea pero no escribe esta clave: ahí no hay gracia.
    const rotated = await refreshTokens.getRotation(decoded.jti);
    if (rotated) {
      logger.info('Refresh concurrente dentro de la ventana de gracia — se reusa el par emitido', {
        userId: decoded.userId,
        jti: decoded.jti
      });
      return rotated;
    }

    // 2. Blacklist individual (logout de esta sesión)
    if (await revocations.isRefreshTokenBlacklisted(refreshTokenStr)) {
      throw new SessionClosedError('La sesión ha expirado. Por favor inicia sesión nuevamente.');
    }

    // 3. Invalidación global (logout-all / reuse attack), contra el iat del refresh: un login posterior emite
    //    tokens nuevos que sí deben poder renovar
    if (await revocations.isUserSessionsInvalidated(decoded.userId, decoded.iat)) {
      throw new SessionClosedError('La sesión ha expirado. Por favor inicia sesión nuevamente.');
    }

    // 4. JTI vigente — reuse attack
    const storedUserId = await refreshTokens.exists(decoded.jti);
    if (!storedUserId) {
      // 4a. Redis caído ≠ token robado (exists() da null en ambos casos): fail-open, se deja rotar
      if (!cache.isAvailable()) {
        logger.warn('Refresh sin verificación de JTI — Redis no disponible', { userId: decoded.userId, jti: decoded.jti });
      } else {
        // 4b. JTI ausente, Redis sano y fuera de la ventana de gracia → reuse real
        return this.handleReuseAttack(decoded);
      }
    }

    // 5. El usuario (con su rol: el access token lleva roleId/roleName)
    const user = await users.findWithRole(decoded.userId);
    if (!user || !user.isActive) {
      throw new IamUnauthorizedError('Usuario no encontrado o inactivo', { code: AUTH_ERROR_CODES.SESSION_CLOSED });
    }

    // 5b. Tope absoluto de la sesión
    if (decoded.sessionId) {
      await this.enforceAbsoluteLifetime(decoded.sessionId, decoded.userId, decoded.jti);
    }

    // 6. Revoca el JTI actual (antes de emitir el nuevo)
    await refreshTokens.revoke(decoded.jti);

    // 7. Tokens nuevos con el sessionId de la sesión original. refreshTs marca la rotación: todo token anterior de
    //    esta sesión queda invalidado (con efecto diferido por la gracia) y prevalece el nuevo.
    const refreshTs = Math.floor(Date.now() / 1000);
    const newJti = random.uuid();
    const newAccessToken = await tokens.generateAccessToken(user, decoded.sessionId);
    const newRefreshToken = await tokens.generateRefreshToken(decoded.userId, newJti, decoded.sessionId);

    // 8. El JTI nuevo (si falla, el refresh nuevo es inútil: el viejo ya se revocó y hay que volver a iniciar sesión)
    if (!(await refreshTokens.save(newJti, decoded.userId))) {
      throw new IamInternalError('Error al renovar la sesión. Por favor inicia sesión nuevamente.');
    }

    // 9. Efectos de la rotación (fire-and-forget)
    this.applyRotationSideEffects(decoded, { refreshTokenStr, refreshTs, newJti });

    await audit.record('TOKEN_REFRESHED', {
      actorId: decoded.userId,
      details: { jti: decoded.jti, newJti },
      entityId: decoded.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    const issued = { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: tokens.accessTokenExpiry };

    // 11. Abre la ventana de gracia (awaited: si se resolviera después de responder, la ráfaga de atrás encontraría
    //     la ventana vacía, que es justo lo que esto evita)
    await refreshTokens.saveRotation(decoded.jti, issued);

    return issued;
  }

  /** El refresh viejo deja de servir, el access anterior de la sesión también y la fila rota su JTI. */
  private applyRotationSideEffects(decoded: RefreshClaims, { refreshTokenStr, refreshTs, newJti }: { refreshTokenStr: string; refreshTs: number; newJti: string }) {
    const { revocations, sessions, logger } = this.deps;
    revocations
      .blacklistRefreshToken(refreshTokenStr)
      .catch(err => logger.warn('Error añadiendo refresh token expirado a blacklist', { error: err.message }));

    if (!decoded.sessionId) {
      return;
    }
    // Umbral DIFERIDO (contado sobre la hora del request, no sobre el iat): siempre hay requests en vuelo con la
    // cookie vieja y un margen por iat no los salvaba nunca
    revocations
      .invalidateSessionTokensOnRotation(decoded.sessionId, refreshTs)
      .catch(err =>
        logger.warn('Error invalidando access token anterior tras refresh', { error: err.message, sessionId: decoded.sessionId })
      );
    sessions
      .updateJtiAndLastAccess(decoded.sessionId, newJti)
      .catch(err => logger.warn('Error actualizando JTI de sesión en BD', { error: err.message, sessionId: decoded.sessionId }));
  }

  /**
   * Reuse attack confirmado → se cierran TODAS las sesiones del usuario. Antes descarta el falso positivo más caro:
   * una sesión cerrada legítimamente (logout en otro dispositivo, revocación del admin, inactividad) también deja su
   * JTI revocado; ahí la respuesta correcta es un 401 normal. Siempre lanza.
   */
  // [RF-AUTH-02] | CA-01 | Reuse attack → invalidación global de las sesiones del usuario
  private async handleReuseAttack(decoded: RefreshClaims): Promise<never> {
    const { sessions, revocations, audit, logger } = this.deps;
    if (decoded.sessionId) {
      const session = await sessions.findById(decoded.sessionId);
      if (session && session.status !== 'active') {
        logger.info('Refresh sobre sesión ya cerrada — no es reuse attack', {
          userId: decoded.userId,
          sessionId: decoded.sessionId,
          closeReason: session.closeReason
        });
        throw new SessionClosedError();
      }
    }

    logger.warn('Reuse attack detectado — invalidando todas las sesiones', { userId: decoded.userId, jti: decoded.jti });
    // Evento forense de seguridad: incidente distinto de "el request falló"
    await audit.record('REFRESH_TOKEN_REUSE_ATTACK', {
      actorId: decoded.userId,
      details: { jti: decoded.jti },
      entityId: decoded.userId,
      entityType: 'User',
      entityTable: 'users',
      outcome: 'failure'
    });
    revocations
      .invalidateUserSessions(decoded.userId)
      .catch(err => logger.warn('Error invalidando sesiones tras reuse attack', { error: err.message }));

    throw new IamUnauthorizedError('Sesión comprometida. Por favor inicia sesión nuevamente.', {
      code: AUTH_ERROR_CODES.SESSION_COMPROMISED
    });
  }

  // [RF-AUTH-02] | CA-01 | Se cierra la sesión, se revoca el JTI, se blacklista y se responde 401
  private async enforceAbsoluteLifetime(sessionId: string, userId: string, jti: string) {
    const { sessions, refreshTokens, revocations, audit, logger, policy } = this.deps;
    const session = await sessions.findById(sessionId);
    if (!session || session.status !== 'active') {
      return;
    }
    if (!exceededAbsoluteLifetime(session, policy.session)) {
      return;
    }

    await sessions.close(sessionId, 'absolute_lifetime');
    refreshTokens
      .revoke(jti)
      .catch(err => logger.warn('Error revocando JTI al expirar sesión por tope absoluto', { error: err.message, sessionId }));
    revocations
      .blacklistSession(sessionId)
      .catch(err => logger.warn('Error invalidando sesión en blacklist por tope absoluto', { error: err.message, sessionId }));
    await audit.record('SESSION_ABSOLUTE_EXPIRED', {
      actorId: userId,
      details: { startedAt: session.startedAt, limitHours: policy.session.absoluteLifetimeHours },
      entityId: sessionId,
      entityType: 'UserSession',
      entityTable: 'user_sessions'
    });
    throw new IamUnauthorizedError('La sesión alcanzó su duración máxima (8 horas). Por favor inicia sesión nuevamente.', {
      code: AUTH_ERROR_CODES.SESSION_ABSOLUTE_LIFETIME
    });
  }
}

// ============================================================
// LOGOUT
// ============================================================

/** Tokens y datos de la sesión actual que el controller saca del request. */
export interface RequestTokens {
  accessToken?: string | null;
  tokenExp?: number | null;
  refreshToken?: string | null;
  sessionId?: string | null;
  firstName?: string | null;
}

type LogoutDeps = Pick<IamDeps, 'sessions' | 'devices' | 'revocations' | 'audit' | 'notifier' | 'logger'>;

// [RF-AUTH-02] | CA-02 | Logout individual: blacklistea access y refresh, cierra la sesión en BD
export class Logout {
  constructor(private readonly deps: LogoutDeps) {}

  async execute(userId: string, fingerprintHash: string, tokens: RequestTokens = {}): Promise<null> {
    const { sessions, devices, revocations, audit, logger } = this.deps;
    const { accessToken, tokenExp, refreshToken, sessionId } = tokens;

    if (sessionId) {
      sessions
        .close(sessionId, 'logout')
        .catch(err => logger.warn('Error cerrando sesión en BD en logout', { error: err.message, userId, sessionId }));
    }

    // El access token deja de servir aunque no haya expirado
    revocations
      .blacklistAccessToken(accessToken, tokenExp)
      .catch(err => logger.warn('Error añadiendo access token a blacklist en logout', { error: err.message, userId }));

    if (refreshToken) {
      revocations
        .blacklistRefreshToken(refreshToken)
        .catch(err => logger.warn('Error añadiendo refresh token a blacklist en logout', { error: err.message, userId }));
    }

    await devices.updateLastSeen(userId, fingerprintHash).catch(err => logger.warn('Error updating last_seen on logout', { error: err.message }));

    await audit.record('LOGOUT', {
      actorId: userId,
      details: { fingerprintHash },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return null;
  }
}

// [RF-AUTH-02] | CA-02 | Logout global: invalida todas las sesiones del usuario (todo el control es propio)
export class LogoutAll {
  constructor(private readonly deps: LogoutDeps) {}

  async execute(userId: string, tokens: RequestTokens = {}): Promise<null> {
    const { sessions, devices, revocations, audit, notifier, logger } = this.deps;
    const { accessToken, tokenExp, firstName } = tokens;

    revocations
      .blacklistAccessToken(accessToken, tokenExp)
      .catch(err => logger.warn('Error añadiendo access token a blacklist en logout-all', { error: err.message, userId }));

    // Cubre los access tokens de las otras sesiones que todavía no expiraron
    revocations
      .invalidateUserSessions(userId)
      .catch(err => logger.warn('Error invalidando sesiones de usuario en logout-all', { error: err.message, userId }));

    sessions
      .closeAllByUser(userId, 'logout_all')
      .catch(err => logger.warn('Error cerrando sesiones en BD en logout-all', { error: err.message, userId }));

    await devices.deleteAllByUser(userId);

    await audit.record('LOGOUT_ALL', { actorId: userId, entityId: userId, entityType: 'User', entityTable: 'users' });

    setImmediate(() => {
      notifier
        .notify({ type: 'LOGOUT_ALL', userId, metadata: { nombre: firstName || 'Usuario' } })
        .catch(err => logger.warn('Error enviando notificación logout all', { error: err.message }));
    });
    return null;
  }
}

// ============================================================
// SESIONES PROPIAS
// ============================================================

export class CloseOwnSession {
  constructor(private readonly sessionControl: SessionControl) {}

  execute(userId: string, sessionId: string, currentSessionId: string | null) {
    return this.sessionControl.closeSessionById(userId, sessionId, currentSessionId);
  }
}

export class CloseOtherSessions {
  constructor(private readonly sessionControl: SessionControl) {}

  execute(userId: string, currentSessionId: string | null) {
    return this.sessionControl.closeOtherSessions(userId, currentSessionId);
  }
}
