// Worker de expiración de la doble aprobación: programa con cron ExpireApprovalRequests. Cada corrida es su propia
// operación de worker. src/main/server.ts lo inicia junto con los demás workers.
//
//   cada día, 03:00   vence las solicitudes pendientes con el plazo (horas hábiles) ya pasado
import cron from 'node-cron';
import { runOperation } from '../../../../shared/infrastructure/observability/operation';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { ExpireApprovalRequests } from '../../application/use-cases/expire-approval-requests.use-case';

// Cron hardcodeado (convención del repo: los workers no leen el cron de env vars)
const CRON_EXPRESSION = '0 3 * * *';

export interface DualApprovalExpirationWorker {
  start(): void;
}

export function createDualApprovalExpirationWorker(expire: ExpireApprovalRequests, logger: Logger): DualApprovalExpirationWorker {
  return {
    start() {
      cron.schedule(CRON_EXPRESSION, () =>
        runOperation({ source: 'worker', name: 'dual-approval-expiration.expire' }, async () => {
          logger.info('Ejecutando worker: expiración de solicitudes de doble aprobación');
          const result = await expire.execute();
          logger.info('Worker de expiración de doble aprobación completado', result);
        })
      );
      logger.info('Worker de expiración de doble aprobación iniciado - tarea: diaria a las 3:00 AM');
    }
  };
}
