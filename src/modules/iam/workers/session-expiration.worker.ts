// === RF-AUTH-02 / RF-AUTH-03: Cierre proactivo de sesiones (inactividad + tope absoluto) ===
//
// Materializa en BD el cierre de las sesiones activas que deben terminar por:
//   1) Inactividad: last_access_at + SESSION_INACTIVITY_MINUTES (15 min). last_access_at lo
//      actualiza el middleware en CADA request autenticado (cliente e interno), así que refleja
//      la última vez que el usuario pegó a cualquier API.
//   2) Tope absoluto: started_at + ABSOLUTE_SESSION_LIFETIME_HOURS (8 h), aunque el usuario siga
//      activo (Circular 052/2007 SFC). El refresh ya lo verifica; el worker lo hace airtight.
//
// El middleware ya cierra reactivamente la sesión (cliente o interno) en su siguiente request;
// este worker cubre el caso en que ese request nunca llega — "cerró la pestaña/app y no volvió".

import cron from 'node-cron';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import { runOperation } from '../../../shared/observability/operation';
import userSessionRepository from '../repositories/user-session.repository';
import RefreshTokenStore from '../utils/refresh-token-store.util';
import TokenBlacklistUtil from '../utils/token-blacklist.util';
import constantsModule from '../../../shared/constants';
const { SECURITY } = constantsModule;
import errorMessageModule from '../../../shared/utils/error-message.util';

const { errorMessage } = errorMessageModule;
import auditModule from '../../audit';
const { audit } = auditModule;


// Cron hardcodeado (convención del repo: los workers no leen el cron de env vars).
// Cada 5 minutos — cierra sesiones por inactividad o por tope absoluto. Corre seguido para
// apretar la ventana de las sesiones huérfanas (usuario que cerró la pestaña y no volvió).
const CRON_EXPRESSION = '*/5 * * * *';
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const REASON_INACTIVITY = 'inactivity_timeout';
const REASON_ABSOLUTE = 'absolute_lifetime';

class SessionExpirationWorker {
  static iniciar() {
    cron.schedule(CRON_EXPRESSION, () =>
      runOperation({ source: 'worker', name: 'session-expiration.sweep' }, async () => {
        logger.info('Ejecutando worker: expiración de sesiones (inactividad + tope absoluto)');
        const result = await SessionExpirationWorker._processExpired();
        logger.info('Worker de expiración de sesiones completado', result);
      })
    );

    logger.info('Worker de expiración de sesiones iniciado - tarea: cada 5 minutos');
  }

  static async _processExpired() {
    const now = Date.now();
    const inactivityCutoff = new Date(now - SECURITY.SESSION_INACTIVITY_MINUTES * MS_PER_MINUTE);
    const absoluteCutoff = new Date(now - SECURITY.ABSOLUTE_SESSION_LIFETIME_HOURS * MS_PER_HOUR);
    const closable = await userSessionRepository.findClosableActive(inactivityCutoff, absoluteCutoff);

    let count = 0;
    for (const session of closable) {
      try {
        const closed = await SessionExpirationWorker._closeSession(session, absoluteCutoff);
        if (closed) {
          count++;
        }
      } catch (error) {
        logger.error('Error al cerrar sesión en worker de expiración', {
          sessionId: session.userSessionId,
          error: errorMessage(error)
        });
      }
    }

    return { scanned: closable.length, closed: count };
  }

  static async _closeSession(
    session: { userSessionId: string; userId: string; jti: string; lastAccessAt: Date; startedAt: Date },
    absoluteCutoff: Date
  ) {
    const sessionId = session.userSessionId;

    // Causa: si superó el tope absoluto de 8h, prevalece esa razón; si no, es inactividad.
    const exceededAbsolute = new Date(session.startedAt) < absoluteCutoff;
    const reason = exceededAbsolute ? REASON_ABSOLUTE : REASON_INACTIVITY;
    const auditAction = exceededAbsolute ? 'SESSION_ABSOLUTE_EXPIRED' : 'SESSION_EXPIRED_BY_WORKER';

    // closeSession solo afecta filas status='active': si el middleware ya la cerró
    // entre el find y el update, affected=0 y evitamos blacklist/auditoría duplicadas.
    const affected = await userSessionRepository.closeSession(sessionId, reason);
    if (!affected) {
      return false;
    }

    RefreshTokenStore.revoke(session.jti).catch(err =>
      logger.warn('Error revocando JTI al expirar sesión en worker', {
        error: err.message,
        sessionId,
        jti: session.jti
      })
    );

    TokenBlacklistUtil.blacklistSession(sessionId).catch(err =>
      logger.warn('Error invalidando sesión en blacklist en worker', {
        error: err.message,
        sessionId
      })
    );

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

export default SessionExpirationWorker;
