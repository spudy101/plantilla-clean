// modules/shared-endpoints/kyc/iam/services/auth-login/session-control.service.ts
//
// Control de sesiones: cierre selectivo, cierre de sesiones previas del mismo
// dispositivo y límite de sesiones simultáneas. Extraído de AuthLoginService (SOLID: S).

import userSessionRepository from '../../repositories/user-session.repository';
import RefreshTokenStore from '../../utils/refresh-token-store.util';
import TokenBlacklistUtil from '../../utils/token-blacklist.util';
import AppError from '../../../../shared/http/app-error.util';
import loggerUtilModule from '../../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/constants';
const { SECURITY } = constantsModule;
import auditModule from '../../../audit';
import type { OtherSessionsClosed, SessionClosed } from '../../responses/auth-login.response';
const { audit } = auditModule;

class SessionControlService {
  userSessionRepository: typeof userSessionRepository;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   AuthLoginService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: SessionControlService.Deps = {}) {
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
  }

  // ============================================================
  // SESIONES — CIERRE SELECTIVO
  // ============================================================

  // [RF-AUTH-02] | CA-02 | Cierre de sesión individual por ID (usado por RF-AUTH-03)
  // [RF-AUTH-03] | CA-02 | Cierra sesión individual que no sea la actual;
  // invalida en BD + revoca JTI en RefreshTokenStore + blacklist en Redis
  async closeSessionById(userId: string, sessionId: string, currentSessionId: string | null) {
    if (sessionId === currentSessionId) {
      throw AppError.badRequest('Para cerrar la sesión actual usa el endpoint de logout');
    }

    const session = await this.userSessionRepository.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw AppError.notFound('Sesión no encontrada');
    }
    if (session.status !== 'active') {
      throw AppError.badRequest('La sesión ya está cerrada');
    }

    await this.userSessionRepository.closeSession(sessionId, 'closed_by_user');

    RefreshTokenStore.revoke(session.jti).catch(err =>
      logger.warn('Error revocando JTI al cerrar sesión por usuario', {
        error: err.message,
        sessionId,
        jti: session.jti
      })
    );

    // Invalida el access token activo de esa sesión de inmediato (no esperar al TTL)
    TokenBlacklistUtil.blacklistSession(sessionId).catch(err =>
      logger.warn('Error invalidando sesión en blacklist al cerrar por usuario', {
        error: err.message,
        sessionId
      })
    );

    await audit.record('SESSION_CLOSED_BY_USER', {
      actorId: userId,
      entityId: sessionId,
      entityType: 'UserSession',
      entityTable: 'user_sessions'
    });

    return { sessionId, status: 'closed' } satisfies SessionClosed;
  }

  // [RF-AUTH-02] | CA-02 | Cierra todas las sesiones salvo la actual
  // [RF-AUTH-03] | CA-02 | Cierra todas las sesiones salvo la actual;
  // revoca cada JTI y blacklista. Devuelve closedCount
  async closeOtherSessions(userId: string, currentSessionId: string | null) {
    const others = await this.userSessionRepository.findActiveByUserExcept(userId, currentSessionId);

    if (others.length === 0) {
      return { closedCount: 0 } satisfies OtherSessionsClosed;
    }

    await this.userSessionRepository.closeAllByUserExcept(userId, currentSessionId, 'logout_others');

    for (const session of others) {
      RefreshTokenStore.revoke(session.jti).catch(err =>
        logger.warn('Error revocando JTI en logout-others', {
          error: err.message,
          sessionId: session.userSessionId,
          jti: session.jti
        })
      );

      // Invalida el access token activo de cada sesión cerrada de inmediato
      TokenBlacklistUtil.blacklistSession(session.userSessionId).catch(err =>
        logger.warn('Error invalidando sesión en blacklist en logout-others', {
          error: err.message,
          sessionId: session.userSessionId
        })
      );
    }

    await audit.record('LOGOUT_OTHERS', {
      actorId: userId,
      details: { closedCount: others.length },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return { closedCount: others.length } satisfies OtherSessionsClosed;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /**
   * Una sesión por dispositivo: al iniciar sesión, cierra e invalida cualquier
   * sesión activa previa del MISMO dispositivo (mismo device_id). El token del
   * login anterior en ese dispositivo deja de servir de inmediato. Las sesiones
   * en OTROS dispositivos no se tocan.
   *
   * @private
   */
  async closePreviousDeviceSessions(userId: string, deviceId: string) {
    if (!deviceId) {
      return;
    }

    const previous = await this.userSessionRepository.findActiveByUserAndDevice(userId, deviceId);
    if (previous.length === 0) {
      return;
    }

    for (const session of previous) {
      this.userSessionRepository.closeSession(session.userSessionId, 'reauth_same_device').catch(err =>
        logger.warn('Error cerrando sesión previa del mismo dispositivo', {
          error: err.message,
          sessionId: session.userSessionId
        })
      );

      RefreshTokenStore.revoke(session.jti).catch(err =>
        logger.warn('Error revocando JTI de sesión previa del mismo dispositivo', {
          error: err.message,
          sessionId: session.userSessionId,
          jti: session.jti
        })
      );

      TokenBlacklistUtil.blacklistSession(session.userSessionId).catch(err =>
        logger.warn('Error invalidando sesión previa del mismo dispositivo', {
          error: err.message,
          sessionId: session.userSessionId
        })
      );
    }

    await audit.record('PREVIOUS_DEVICE_SESSIONS_CLOSED', {
      actorId: userId,
      details: {
        closedCount: previous.length
      },
      entityId: deviceId,
      entityType: 'UserTrustedDevice',
      entityTable: 'user_trusted_devices'
    });
  }

  /** @private */
  // [RF-AUTH-03] | CA-04 | Aplica límite de 5 sesiones simultáneas; si se supera,
  // busca la más antigua, la cierra en BD, revoca en Redis y registra auditoría
  async enforceSessionLimit(userId: string) {
    const activeCount = await this.userSessionRepository.countActive(userId);
    if (activeCount < SECURITY.MAX_ACTIVE_SESSIONS) {
      return;
    }

    const oldest = await this.userSessionRepository.findOldestActive(userId);
    if (!oldest) {
      return;
    }

    await this.userSessionRepository.closeSession(oldest.userSessionId, 'session_limit');

    RefreshTokenStore.revoke(oldest.jti).catch(err =>
      logger.warn('Error revocando JTI al aplicar límite de sesiones', {
        error: err.message,
        sessionId: oldest.userSessionId,
        jti: oldest.jti
      })
    );

    // Invalida el access token activo de la sesión más antigua de inmediato
    TokenBlacklistUtil.blacklistSession(oldest.userSessionId).catch(err =>
      logger.warn('Error invalidando sesión en blacklist al aplicar límite de sesiones', {
        error: err.message,
        sessionId: oldest.userSessionId
      })
    );

    await audit.record('SESSION_LIMIT_ENFORCED', {
      actorId: userId,
      details: {
        activeCount
      },
      entityId: oldest.userSessionId,
      entityType: 'UserSession',
      entityTable: 'user_sessions'
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace SessionControlService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userSessionRepository?: typeof userSessionRepository;
  }
}

export default SessionControlService;
