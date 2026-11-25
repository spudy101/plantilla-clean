// Piezas de sesión que comparten los logins (contraseña, biometría, registro) y la gestión de sesiones:
//
//   SessionIssuer    emite una sesión autenticada: par de tokens RS256 + JTI del refresh + fila en user_sessions
//   SessionControl   cierra sesiones: la previa del mismo dispositivo, la más antigua al superar el límite, una
//                    elegida por el usuario o todas las demás
import type { IssuedTokens, TokenUser } from '../ports/auth-tokens.port';
import { IamInvalidInputError, SessionNotFoundError } from '../../domain/errors';
import type { SessionKey } from '../../domain/session';
import type { OtherSessionsClosed, SessionClosed } from '../dto/auth-login.output';
import type { IamDeps } from './iam-deps';

export class SessionIssuer {
  constructor(private readonly deps: Pick<IamDeps, 'sessions' | 'tokens' | 'refreshTokens' | 'random' | 'logger'>) {}

  /** `source`: etiqueta para los logs (p. ej. 'login', 'login biométrico', 'registro'). */
  async issue(
    user: TokenUser,
    {
      deviceId = null,
      ip = null,
      userAgent = null,
      source
    }: { deviceId?: string | null; ip?: string | null; userAgent?: string | null; source: string }
  ): Promise<{ sessionId: string; tokens: IssuedTokens }> {
    const { sessions, tokens, refreshTokens, random, logger } = this.deps;
    const { userId } = user;
    const sessionId = random.uuid();
    const jti = random.uuid();
    const accessToken = await tokens.generateAccessToken(user, sessionId);
    const refreshToken = await tokens.generateRefreshToken(userId, jti, sessionId);

    // JTI awaited: si falla, el refresh no servirá, pero no bloqueamos la autenticación
    const jtiSaved = await refreshTokens.save(jti, userId);
    if (!jtiSaved) {
      logger.warn(`No se pudo guardar JTI de refresh token en ${source}`, { userId });
    }

    // [RF-AUTH-02] | CA-04 | Sesión activa con IP, user-agent, started_at y last_access_at (fire-and-forget)
    sessions
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

    return { sessionId, tokens: { accessToken, refreshToken, expiresIn: tokens.accessTokenExpiry } };
  }
}

export class SessionControl {
  constructor(private readonly deps: Pick<IamDeps, 'sessions' | 'refreshTokens' | 'revocations' | 'audit' | 'logger' | 'policy'>) {}

  /** Revoca el refresh y el access de una sesión ya cerrada en BD (fire-and-forget). */
  private revokeTokens(session: SessionKey, context: { revoke: string; blacklist: string }) {
    const { refreshTokens, revocations, logger } = this.deps;
    refreshTokens.revoke(session.jti).catch(err =>
      logger.warn(`Error revocando JTI ${context.revoke}`, { error: err.message, sessionId: session.userSessionId, jti: session.jti })
    );
    revocations.blacklistSession(session.userSessionId).catch(err =>
      logger.warn(`Error invalidando ${context.blacklist}`, { error: err.message, sessionId: session.userSessionId })
    );
  }

  // [RF-AUTH-03] | CA-02 | Cierra una sesión propia que no sea la actual; invalida en BD + revoca el JTI + blacklist
  async closeSessionById(userId: string, sessionId: string, currentSessionId: string | null): Promise<SessionClosed> {
    const { sessions, audit } = this.deps;
    if (sessionId === currentSessionId) {
      throw new IamInvalidInputError('Para cerrar la sesión actual usa el endpoint de logout');
    }
    const session = await sessions.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new SessionNotFoundError();
    }
    if (session.status !== 'active') {
      throw new IamInvalidInputError('La sesión ya está cerrada');
    }

    await sessions.close(sessionId, 'closed_by_user');
    this.revokeTokens(session, CONTEXT.byUser);

    await audit.record('SESSION_CLOSED_BY_USER', {
      actorId: userId,
      entityId: sessionId,
      entityType: 'UserSession',
      entityTable: 'user_sessions'
    });

    return { sessionId, status: 'closed' };
  }

  // [RF-AUTH-03] | CA-02 | Cierra todas las sesiones salvo la actual; revoca cada JTI y blacklista
  async closeOtherSessions(userId: string, currentSessionId: string | null): Promise<OtherSessionsClosed> {
    const { sessions, audit } = this.deps;
    const others = await sessions.findActiveByUserExcept(userId, currentSessionId);
    if (others.length === 0) {
      return { closedCount: 0 };
    }

    await sessions.closeAllByUserExcept(userId, currentSessionId, 'logout_others');
    for (const session of others) {
      this.revokeTokens(session, CONTEXT.others);
    }

    await audit.record('LOGOUT_OTHERS', {
      actorId: userId,
      details: { closedCount: others.length },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return { closedCount: others.length };
  }

  /**
   * Una sesión por dispositivo: al iniciar sesión se cierra cualquier sesión activa previa del MISMO dispositivo
   * (su token deja de servir de inmediato). Las de otros dispositivos no se tocan.
   */
  async closePreviousDeviceSessions(userId: string, deviceId: string | null): Promise<void> {
    const { sessions, audit, logger } = this.deps;
    if (!deviceId) {
      return;
    }
    const previous = await sessions.findActiveByUserAndDevice(userId, deviceId);
    if (previous.length === 0) {
      return;
    }

    for (const session of previous) {
      sessions
        .close(session.userSessionId, 'reauth_same_device')
        .catch(err => logger.warn('Error cerrando sesión previa del mismo dispositivo', { error: err.message, sessionId: session.userSessionId }));
      this.revokeTokens(session, CONTEXT.sameDevice);
    }

    await audit.record('PREVIOUS_DEVICE_SESSIONS_CLOSED', {
      actorId: userId,
      details: { closedCount: previous.length },
      entityId: deviceId,
      entityType: 'UserTrustedDevice',
      entityTable: 'user_trusted_devices'
    });
  }

  // [RF-AUTH-03] | CA-04 | Límite de sesiones simultáneas: si se alcanzó, se cierra la más antigua
  async enforceSessionLimit(userId: string): Promise<void> {
    const { sessions, audit, policy } = this.deps;
    const activeCount = await sessions.countActive(userId);
    if (activeCount < policy.session.maxActiveSessions) {
      return;
    }
    const oldest = await sessions.findOldestActive(userId);
    if (!oldest) {
      return;
    }

    await sessions.close(oldest.userSessionId, 'session_limit');
    this.revokeTokens(oldest, CONTEXT.limit);

    await audit.record('SESSION_LIMIT_ENFORCED', {
      actorId: userId,
      details: { activeCount },
      entityId: oldest.userSessionId,
      entityType: 'UserSession',
      entityTable: 'user_sessions'
    });
  }
}

/** Los mensajes de log de cada cierre (los mismos de antes). */
const CONTEXT = {
  byUser: { revoke: 'al cerrar sesión por usuario', blacklist: 'sesión en blacklist al cerrar por usuario' },
  others: { revoke: 'en logout-others', blacklist: 'sesión en blacklist en logout-others' },
  sameDevice: { revoke: 'de sesión previa del mismo dispositivo', blacklist: 'sesión previa del mismo dispositivo' },
  limit: { revoke: 'al aplicar límite de sesiones', blacklist: 'sesión en blacklist al aplicar límite de sesiones' }
} as const;

