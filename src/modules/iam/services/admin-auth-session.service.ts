// === RF-AUTH-02, RF-AUTH-03: Login, Gestión de Sesión Segura y Recuperación de Contraseña ===
// === RF-AUTH-03 (admin): Gestión de Dispositivos Autenticados y Control de Sesiones ===

import userSessionRepository from '../repositories/user-session.repository';
import auditModule from '../../audit';
const { auditLogRepository, audit } = auditModule;
import RefreshTokenStore from '../utils/refresh-token-store.util';
import TokenBlacklistUtil from '../utils/token-blacklist.util';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/constants';
const { notifications } = constantsModule;
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import domainEnumsModule from '../../../shared/constants/domain-enums';
const { USER_SESSION_STATUS } = domainEnumsModule;
import adminAuthSessionDtoModule from '../responses/admin-auth-session.response';
import type { SessionRevoked } from '../responses/admin-auth-session.response';
import { pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { AdminSessionListQuery, AttemptListQuery, AttemptsByUserQuery, SessionsByUserQuery } from '../requests/iam.request';
const { SessionListDTO, AuthAttemptListDTO } = adminAuthSessionDtoModule;
const AUTH_CATEGORY = 'Autenticación';
const DEFAULT_DATE_FROM = new Date('2000-01-01');

// scope=login → solo intentos de inicio de sesión (no toda la categoría 'Autenticación')
const LOGIN_ACTIONS = [
  'LOGIN_SUCCESS', // inicio de sesión exitoso
  'LOGIN_FAILED', // intento fallido
  'LOGIN_BLOCKED_DEVICE', // intento desde dispositivo bloqueado
  'LOGIN_BLOCKED_POLICY_UPDATE', // inicio bloqueado por política pendiente
  'ACCOUNT_BLOCKED', // cuenta bloqueada por múltiples fallos
  'REFRESH_TOKEN_REUSE_ATTACK' // reuso de refresh token detectado
];

class AdminAuthSessionService {
  userSessionRepository: typeof userSessionRepository;
  auditLogRepository: typeof auditLogRepository;
  notifier: typeof notifier;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AdminAuthSessionService({ userSessionRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: AdminAuthSessionService.Deps = {}) {
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
    this.auditLogRepository = deps.auditLogRepository ?? auditLogRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  // [RF-AUTH-02] | CA-04 | Superficie de consumo para RF-AUTH-03: lista sesiones con JOIN a dispositivos
  // [RF-AUTH-03] | CA-01 | Vista admin de sesiones activas (equivalente a
  // /auth/devices pero con vista por sesión cruda y scope de todos los usuarios)
  async listSessions(query: AdminSessionListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = {
      sessionId: query.sessionId ?? undefined,
      userId: query.userId ?? undefined,
      status: query.status ?? undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined
    };
    const where = this.userSessionRepository.buildWhere(filters);

    const { rows, count } = await this.userSessionRepository.findPaginatedWithDeviceAndUser(where, page);

    await audit.record('AUTH_SESSION_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count },
      entityType: 'AuthSession',
      entityTable: 'user_sessions'
    });

    return SessionListDTO(rows, pageMetadata(page, count, filters));
  }

  // [RF-AUTH-02] | CA-04 | Superficie de consumo para RF-AUTH-03: lista sesiones con JOIN a dispositivos
  // [RF-AUTH-03] | CA-01 | Vista admin de sesiones activas (equivalente a
  // /auth/devices pero con vista por sesión cruda y scope de todos los usuarios)
  async getSessionsByUser(userId: string, query: SessionsByUserQuery, adminUserId: string) {
    const page = pageRequest(query);
    const where = this.userSessionRepository.buildWhere({ userId, status: query.status ?? undefined });

    const { rows, count } = await this.userSessionRepository.findPaginatedWithDeviceAndUser(where, page);

    await audit.record('AUTH_SESSION_BY_USER_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      entityType: 'InternalUser'
    });

    return SessionListDTO(rows, pageMetadata(page, count, { status: query.status }));
  }

  // [RF-AUTH-02] | CA-02, CA-04 | Revocación administrativa de sesión individual
  // [RF-AUTH-03] | CA-02 | Revocación administrativa de sesión con notificación
  // al usuario (supera lo especificado en el requerimiento)
  async revokeSession(sessionId: string, adminUserId: string) {
    const session = await this.userSessionRepository.findById(sessionId);
    if (!session) {
      throw AppError.notFound('Sesión no encontrada');
    }
    if (session.status !== USER_SESSION_STATUS.ACTIVE) {
      throw AppError.badRequest('La sesión ya está cerrada');
    }

    await this.userSessionRepository.closeSession(sessionId, 'revoked_by_admin');

    RefreshTokenStore.revoke(session.jti).catch(err =>
      logger.warn('Error revocando JTI en Redis al revocar sesión por admin', {
        error: err.message,
        sessionId,
        jti: session.jti
      })
    );

    // Invalidación quirúrgica: solo el access token de ESTA sesión (umbral por sessionId).
    // No usar invalidateUserSessions (umbral global del usuario) — mataría las demás sesiones.
    TokenBlacklistUtil.blacklistSession(sessionId).catch(err =>
      logger.warn('Error invalidando la sesión en Redis al revocar por admin', {
        error: err.message,
        sessionId,
        userId: session.userId
      })
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

    setImmediate(() => {
      this.notifier.notify({
        type: 'AUTH_SESSION_REVOKED_INTERNAL',
        userId: adminUserId,
        relatedEntity: { type: 'UserSession', id: sessionId },
        metadata: { sessionId, targetUserId: session.userId, logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error enviando AUTH_SESSION_REVOKED_INTERNAL', { error: err.message }));
    });

    setImmediate(() => {
      this.notifier.notify({
        type: 'AUTH_SESSION_REVOKED_CLIENT',
        userId: session.userId,
        relatedEntity: { type: 'UserSession', id: sessionId },
        metadata: { logoUrl: notifications.ses.logoUrl }
      }).catch(err => logger.warn('Error enviando AUTH_SESSION_REVOKED_CLIENT', { error: err.message }));
    });

    return { sessionId, status: 'closed', closeReason: 'revoked_by_admin' } satisfies SessionRevoked;
  }

  // Traduce el query HTTP a criterios de negocio (sin Sequelize): scope, usuario, outcome y rango de fechas.
  // scope=login → solo LOGIN_ACTIONS; scope=all (default) → toda la categoría 'Autenticación'.
  // El repositorio es quien convierte estos criterios en un WHERE.
  _buildAttemptsCriteria(query: AttemptsByUserQuery & { userId?: string | null }, forcedUserId: string | null = null) {
    const from = query.dateFrom ?? DEFAULT_DATE_FROM;
    const to = query.dateTo ?? new Date();
    const isLoginScope = query.scope === 'login';

    return {
      from,
      to,
      actions: isLoginScope ? LOGIN_ACTIONS : undefined,
      category: isLoginScope ? undefined : AUTH_CATEGORY,
      userId: forcedUserId || query.userId || undefined,
      outcome: query.outcome || undefined
    };
  }

  async listAttempts(query: AttemptListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const criteria = this._buildAttemptsCriteria(query);

    const { rows, count } = await this.auditLogRepository.findAuthAttemptsPaginated(criteria, page);

    const scope = query.scope || 'all';
    await audit.record('AUTH_ATTEMPTS_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, scope },
      entityType: 'AuditLog',
      entityTable: 'audit_logs'
    });

    return AuthAttemptListDTO(rows, pageMetadata(page, count, { scope, outcome: query.outcome, dateFrom: query.dateFrom, dateTo: query.dateTo }));
  }

  async getAttemptsByUser(userId: string, query: AttemptsByUserQuery, adminUserId: string) {
    const page = pageRequest(query);
    const criteria = this._buildAttemptsCriteria(query, userId);

    const { rows, count } = await this.auditLogRepository.findAuthAttemptsPaginated(criteria, page);

    const scope = query.scope || 'all';
    await audit.record('AUTH_ATTEMPTS_BY_USER_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId, scope },
      entityId: userId,
      entityType: 'InternalUser'
    });

    return AuthAttemptListDTO(rows, pageMetadata(page, count, { scope, outcome: query.outcome, dateFrom: query.dateFrom, dateTo: query.dateTo }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminAuthSessionService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userSessionRepository?: typeof userSessionRepository;
    auditLogRepository?: typeof auditLogRepository;
    notifier?: typeof notifier;
  }
}

export default Object.assign(new AdminAuthSessionService(), { AdminAuthSessionService });
