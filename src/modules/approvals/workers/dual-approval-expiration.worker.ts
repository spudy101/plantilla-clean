import cron from 'node-cron';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import { runOperation } from '../../../shared/infrastructure/observability/operation';
import approvalRequestRepository from '../repositories/approval-request.repository';
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;
import auditModule from '../../audit';
const { audit } = auditModule;


// Cron hardcodeado (convención del repo: los workers no leen el cron de env vars).
// Diario a las 3:00 AM — marca `expired` las solicitudes pendientes con TTL vencido.
const CRON_EXPRESSION = '0 3 * * *';

class DualApprovalExpirationWorker {
  static iniciar() {
    cron.schedule(CRON_EXPRESSION, () =>
      runOperation({ source: 'worker', name: 'dual-approval-expiration.expire' }, async () => {
        logger.info('Ejecutando worker: expiración de solicitudes de doble aprobación');
        const result = await DualApprovalExpirationWorker._processExpired();
        logger.info('Worker de expiración de doble aprobación completado', result);
      })
    );

    logger.info('Worker de expiración de doble aprobación iniciado - tarea: diaria a las 3:00 AM');
  }

  static async _processExpired() {
    const now = new Date();
    const expired = await approvalRequestRepository.findExpired(now);

    let count = 0;
    for (const request of expired) {
      try {
        // Solo si sigue pendiente: si alguien la resolvió entre la consulta y acá, no se pisa
        const marked = await approvalRequestRepository.markExpired(request.approvalRequestId, now);
        if (!marked) {
          continue;
        }

        await audit.record('DUAL_APPROVAL_EXPIRED', {
          actorId: 'system',
          details: {
            approvalRequestId: request.approvalRequestId,
            operationKey: request.operationKey,
            entityType: request.entityType,
            entityId: request.entityId,
            expiresAt: request.expiresAt
          },
          entityId: request.approvalRequestId,
          entityType: 'ApprovalRequest',
          entityTable: 'approval_requests'
        });

        count++;
      } catch (error) {
        logger.error('Error al expirar solicitud de doble aprobación', {
          approvalRequestId: request.approvalRequestId,
          error: errorMessage(error)
        });
      }
    }

    return { expired: count };
  }
}

export default DualApprovalExpirationWorker;
