// === RF-AUTH-02 / RF-AUTH-03: Cierre proactivo de sesiones (inactividad + tope absoluto) ===
//
// Programa el caso de uso ExpireSessions: cierra en BD las sesiones activas que debían terminar por inactividad
// (last_access_at + 15 min) o por tope absoluto (started_at + 8 h, Circular 052/2007 SFC). La autenticación ya las
// cierra en su siguiente request; esto cubre el que nunca llega ("cerró la pestaña/app y no volvió").
// src/main/server.ts lo inicia.
import cron from 'node-cron';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import { runOperation } from '../../../../shared/infrastructure/observability/operation';
import type { ExpireSessions } from '../../application/use-cases/admin-sessions.use-cases';

// Cron hardcodeado (convención del repo: los workers no leen el cron de env vars). Cada 5 minutos, para apretar la
// ventana de las sesiones huérfanas.
const CRON_EXPRESSION = '*/5 * * * *';

export interface SessionExpirationWorker {
  start(): void;
}

export function createSessionExpirationWorker(expireSessions: ExpireSessions, logger: Logger): SessionExpirationWorker {
  return {
    start() {
      cron.schedule(CRON_EXPRESSION, () =>
        runOperation({ source: 'worker', name: 'session-expiration.sweep' }, async () => {
          logger.info('Ejecutando worker: expiración de sesiones (inactividad + tope absoluto)');
          const result = await expireSessions.execute();
          logger.info('Worker de expiración de sesiones completado', result);
        })
      );
      logger.info('Worker de expiración de sesiones iniciado - tarea: cada 5 minutos');
    }
  };
}
