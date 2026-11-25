// Caso de uso: vencer las solicitudes pendientes cuyo plazo (horas hábiles) ya pasó. Lo corre el worker diario.
// Una que falle no frena a las demás.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { ApprovalRequestRepository } from '../ports/approval-request-repository.port';
import { APPROVAL_AUDIT_ENTITY } from './approvals-audit';

const { errorMessage } = errorMessageModule;

export class ExpireApprovalRequests {
  constructor(
    private readonly requests: ApprovalRequestRepository,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute(now = new Date()): Promise<{ expired: number }> {
    const due = await this.requests.findExpired(now);

    let expired = 0;
    for (const request of due) {
      try {
        // Solo si sigue pendiente: si alguien la resolvió entre la consulta y acá, no se pisa
        if (!(await this.requests.markExpired(request.approvalRequestId, now))) {
          continue;
        }
        await this.audit.record('DUAL_APPROVAL_EXPIRED', {
          actorId: 'system',
          details: {
            approvalRequestId: request.approvalRequestId,
            operationKey: request.operationKey,
            entityType: request.entityType,
            entityId: request.entityId,
            expiresAt: request.expiresAt
          },
          entityId: request.approvalRequestId,
          ...APPROVAL_AUDIT_ENTITY
        });
        expired++;
      } catch (error) {
        this.logger.error('Error al expirar solicitud de doble aprobación', {
          approvalRequestId: request.approvalRequestId,
          error: errorMessage(error)
        });
      }
    }
    return { expired };
  }
}
