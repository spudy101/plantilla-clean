// Casos de uso de la vista admin de sesiones (RF-AUTH-02/03): listar sesiones (todas o de un usuario), revocar una
// y ver los intentos de autenticación. Más el barrido periódico que cierra las sesiones vencidas.
import { pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { IamInvalidInputError, SessionNotFoundError } from '../../domain/errors';
import { sweepCutoffs, sweepReason, type ClosableSession } from '../../domain/session';
import adminAuthSessionDtoModule, { type SessionRevoked } from '../dto/admin-auth-session.output';
import type { IamDeps } from './iam-deps';

const { errorMessage } = errorMessageModule;
const { SessionListDTO, AuthAttemptListDTO } = adminAuthSessionDtoModule;

export type AdminSessionListQuery = PageQuery & {
  sessionId?: string | null;
  userId?: string | null;
  status?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
};
export type SessionsByUserQuery = PageQuery & { status?: string | null };
export type AttemptsByUserQuery = PageQuery & {
  scope?: string | null;
  outcome?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
};
export type AttemptListQuery = AttemptsByUserQuery & { userId?: string | null };

const AUTH_CATEGORY = 'Autenticación';
const DEFAULT_DATE_FROM = new Date('2000-01-01');

// scope=login → solo los intentos de inicio de sesión (no toda la categoría 'Autenticación')
const LOGIN_ACTIONS = [
  'LOGIN_SUCCESS', // inicio de sesión exitoso
  'LOGIN_FAILED', // intento fallido
  'LOGIN_BLOCKED_DEVICE', // intento desde dispositivo bloqueado
  'LOGIN_BLOCKED_POLICY_UPDATE', // inicio bloqueado por política pendiente
  'ACCOUNT_BLOCKED', // cuenta bloqueada por múltiples fallos
  'REFRESH_TOKEN_REUSE_ATTACK' // reuso de refresh token detectado
];

/** Los criterios de negocio del listado de intentos: scope, usuario, resultado y rango de fechas. */
function attemptsCriteria(query: AttemptListQuery, forcedUserId: string | null = null) {
  const isLoginScope = query.scope === 'login';
  return {
    from: query.dateFrom ?? DEFAULT_DATE_FROM,
    to: query.dateTo ?? new Date(),
    actions: isLoginScope ? LOGIN_ACTIONS : undefined,
    category: isLoginScope ? undefined : AUTH_CATEGORY,
    userId: forcedUserId || query.userId || undefined,
    outcome: query.outcome || undefined
  };
}

const attemptsFilters = (query: AttemptsByUserQuery, scope: string) => ({
  scope,
  outcome: query.outcome,
  dateFrom: query.dateFrom,
  dateTo: query.dateTo
});

type SessionDeps = Pick<IamDeps, 'sessions' | 'audit'>;

// [RF-AUTH-03] | CA-01 | Vista admin de las sesiones de todos los usuarios, con su dispositivo
export class ListSessions {
  constructor(private readonly deps: SessionDeps) {}

  async execute(query: AdminSessionListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = {
      sessionId: query.sessionId ?? undefined,
      userId: query.userId ?? undefined,
      status: query.status ?? undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined
    };
    const { rows, count } = await this.deps.sessions.findPaginatedWithDeviceAndUser(filters, page);
    await this.deps.audit.record('AUTH_SESSION_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count },
      entityType: 'AuthSession',
      entityTable: 'user_sessions'
    });
    return SessionListDTO(rows, pageMetadata(page, count, filters));
  }
}

export class ListUserSessions {
  constructor(private readonly deps: SessionDeps) {}

  async execute(userId: string, query: SessionsByUserQuery, adminUserId: string) {
    const page = pageRequest(query);
    const { rows, count } = await this.deps.sessions.findPaginatedWithDeviceAndUser({ userId, status: query.status ?? undefined }, page);
    await this.deps.audit.record('AUTH_SESSION_BY_USER_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      entityType: 'InternalUser'
    });
    return SessionListDTO(rows, pageMetadata(page, count, { status: query.status }));
  }
}

// [RF-AUTH-03] | CA-02 | Revocación administrativa de una sesión, con aviso al admin y al usuario
export class RevokeSession {
  constructor(private readonly deps: Pick<IamDeps, 'sessions' | 'refreshTokens' | 'revocations' | 'audit' | 'notifier' | 'logger' | 'policy'>) {}

  async execute(sessionId: string, adminUserId: string): Promise<SessionRevoked> {
    const { sessions, refreshTokens, revocations, audit, notifier, logger, policy } = this.deps;
    const session = await sessions.findById(sessionId);
    if (!session) {
      throw new SessionNotFoundError();
    }
    if (session.status !== 'active') {
      throw new IamInvalidInputError('La sesión ya está cerrada');
    }

    await sessions.close(sessionId, 'revoked_by_admin');
    refreshTokens.revoke(session.jti).catch(err =>
      logger.warn('Error revocando JTI en Redis al revocar sesión por admin', { error: err.message, sessionId, jti: session.jti })
    );
    // Invalidación quirúrgica: solo el access token de ESTA sesión (no el umbral global del usuario)
    revocations.blacklistSession(sessionId).catch(err =>
      logger.warn('Error invalidando la sesión en Redis al revocar por admin', { error: err.message, sessionId, userId: session.userId })
    );

    await audit.record('AUTH_SESSION_REVOKED', {
      actorId: adminUserId,
      details: {
        targetUserId: session.userId,
        jti: session.jti,
        before: { status: 'active' },
        after: { status: 'revoked_by_admin' }
      },
      entityId: sessionId,
      entityType: 'AuthSession'
    });

    const logoUrl = policy.notificationLogoUrl;
    setImmediate(() => {
      notifier
        .notify({
          type: 'AUTH_SESSION_REVOKED_INTERNAL',
          userId: adminUserId,
          relatedEntity: { type: 'UserSession', id: sessionId },
          metadata: { sessionId, targetUserId: session.userId, logoUrl }
        })
        .catch(err => logger.warn('Error enviando AUTH_SESSION_REVOKED_INTERNAL', { error: err.message }));
    });
    setImmediate(() => {
      notifier
        .notify({
          type: 'AUTH_SESSION_REVOKED_CLIENT',
          userId: session.userId,
          relatedEntity: { type: 'UserSession', id: sessionId },
          metadata: { logoUrl }
        })
        .catch(err => logger.warn('Error enviando AUTH_SESSION_REVOKED_CLIENT', { error: err.message }));
    });

    return { sessionId, status: 'closed', closeReason: 'revoked_by_admin' };
  }
}

type AttemptDeps = Pick<IamDeps, 'authAttempts' | 'audit'>;

export class ListAuthAttempts {
  constructor(private readonly deps: AttemptDeps) {}

  async execute(query: AttemptListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const { rows, count } = await this.deps.authAttempts.list(attemptsCriteria(query), page);
    const scope = query.scope || 'all';
    await this.deps.audit.record('AUTH_ATTEMPTS_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, scope },
      entityType: 'AuditLog',
      entityTable: 'audit_logs'
    });
    return AuthAttemptListDTO(rows, pageMetadata(page, count, attemptsFilters(query, scope)));
  }
}

export class ListUserAuthAttempts {
  constructor(private readonly deps: AttemptDeps) {}

  async execute(userId: string, query: AttemptsByUserQuery, adminUserId: string) {
    const page = pageRequest(query);
    const { rows, count } = await this.deps.authAttempts.list(attemptsCriteria(query, userId), page);
    const scope = query.scope || 'all';
    await this.deps.audit.record('AUTH_ATTEMPTS_BY_USER_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId, scope },
      entityId: userId,
      entityType: 'InternalUser'
    });
    return AuthAttemptListDTO(rows, pageMetadata(page, count, attemptsFilters(query, scope)));
  }
}

// ============================================================
// BARRIDO DE SESIONES VENCIDAS
// ============================================================

/**
 * [RF-AUTH-02 / RF-AUTH-03] Cierra en BD las sesiones activas que debían terminar por inactividad (15 min sin pegarle
 * a ninguna API) o por tope absoluto (8 h desde started_at). La autenticación ya las cierra en su siguiente request;
 * esto cubre el request que nunca llega ("cerró la pestaña y no volvió").
 */
export class ExpireSessions {
  constructor(private readonly deps: Pick<IamDeps, 'sessions' | 'refreshTokens' | 'revocations' | 'audit' | 'logger' | 'policy'>) {}

  async execute(): Promise<{ scanned: number; closed: number }> {
    const { sessions, logger, policy } = this.deps;
    const { inactivityCutoff, absoluteCutoff } = sweepCutoffs(policy.session);
    const closable = await sessions.findClosable(inactivityCutoff, absoluteCutoff);

    let count = 0;
    for (const session of closable) {
      try {
        if (await this.close(session, absoluteCutoff)) {
          count++;
        }
      } catch (error) {
        logger.error('Error al cerrar sesión en worker de expiración', { sessionId: session.userSessionId, error: errorMessage(error) });
      }
    }
    return { scanned: closable.length, closed: count };
  }

  private async close(session: ClosableSession, absoluteCutoff: Date): Promise<boolean> {
    const { sessions, refreshTokens, revocations, audit, logger } = this.deps;
    const sessionId = session.userSessionId;
    const { reason, auditAction } = sweepReason(session, absoluteCutoff);

    // Solo cierra si sigue activa: si la autenticación la cerró entre el find y el update, no se duplica nada
    if (!(await sessions.close(sessionId, reason))) {
      return false;
    }

    refreshTokens
      .revoke(session.jti)
      .catch(err => logger.warn('Error revocando JTI al expirar sesión en worker', { error: err.message, sessionId, jti: session.jti }));
    revocations
      .blacklistSession(sessionId)
      .catch(err => logger.warn('Error invalidando sesión en blacklist en worker', { error: err.message, sessionId }));

    await audit.record(auditAction, {
      actorId: 'system',
      details: {
        targetUserId: session.userId,
        jti: session.jti,
        lastAccessAt: session.lastAccessAt,
        startedAt: session.startedAt,
        before: { status: 'active' },
        after: { status: 'closed', closeReason: reason }
      },
      entityId: sessionId,
      entityType: 'UserSession',
      entityTable: 'user_sessions'
    });
    return true;
  }
}
