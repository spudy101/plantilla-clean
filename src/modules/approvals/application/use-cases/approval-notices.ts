// Avisos de la doble aprobación: a los aprobadores cuando se abre una solicitud y al maker cuando se resuelve.
// Salen en segundo plano y no bloquean nada: si uno falla, se loguea y los demás siguen.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { Notifier } from '../../../../shared/application/ports/notifier.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { ApprovalRequest, ResolutionDecision } from '../../domain/approval-request';
import type { DualApprovalOperation } from '../../domain/dual-approval-operation';
import type { ApproverDirectory } from '../ports/approver-directory.port';

const { errorMessage } = errorMessageModule;

const RESOLVED_NOTIFICATION = 'DUAL_APPROVAL_RESOLVED';

export class ApprovalNotices {
  constructor(
    private readonly approvers: ApproverDirectory,
    private readonly notifier: Notifier,
    private readonly logger: Logger,
    /** Logo de las plantillas de correo (configuración del despliegue). */
    private readonly logoUrl: string | null | undefined
  ) {}

  /** A cada usuario activo con un rol aprobador de la operación. */
  async notifyApprovers(op: DualApprovalOperation, request: ApprovalRequest, ctx: AdminAuditContext): Promise<void> {
    let approverIds: string[];
    try {
      approverIds = await this.approvers.activeUserIdsWithRoles(op.approverRoles);
    } catch (err) {
      this.logger.warn('[DualApproval] Error buscando aprobadores', { error: errorMessage(err), operationKey: request.operationKey });
      return;
    }

    for (const userId of approverIds) {
      setImmediate(() => {
        this.notifier
          .notify({
            type: op.notificationType,
            userId,
            relatedEntity: { type: 'ApprovalRequest', id: request.approvalRequestId },
            metadata: {
              approvalRequestId: request.approvalRequestId,
              operationLabel: op.label,
              entityType: request.entityType,
              entityId: request.entityId,
              firstName: ctx.adminFirstName ?? '',
              logoUrl: this.logoUrl ?? ''
            }
          })
          .catch((err: unknown) =>
            this.logger.warn('[DualApproval] Error notificando aprobador', { error: errorMessage(err), approvalRequestId: request.approvalRequestId })
          );
      });
    }
  }

  /** Al maker, la decisión tomada sobre su solicitud. */
  notifyMaker(request: ApprovalRequest, op: DualApprovalOperation, decision: ResolutionDecision): void {
    if (!request.requestedBy) {
      return;
    }
    setImmediate(() => {
      this.notifier
        .notify({
          type: RESOLVED_NOTIFICATION,
          userId: request.requestedBy,
          relatedEntity: { type: 'ApprovalRequest', id: request.approvalRequestId },
          metadata: { approvalRequestId: request.approvalRequestId, operationLabel: op.label, decision, logoUrl: this.logoUrl ?? '' }
        })
        .catch((err: unknown) =>
          this.logger.warn('[DualApproval] Error notificando al maker', { error: errorMessage(err), approvalRequestId: request.approvalRequestId })
        );
    });
  }
}
