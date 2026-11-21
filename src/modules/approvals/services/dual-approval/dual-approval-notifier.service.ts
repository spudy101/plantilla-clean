// modules/schemas/core/services/dual-approval/dual-approval-notifier.service.ts
//
// Notificaciones del framework de doble aprobación: aviso a los aprobadores cuando se crea una
// solicitud y aviso al solicitante (maker) cuando se resuelve. Extraído de DualApprovalService
// (SOLID: S) — el canal y el contenido de los avisos cambian por razones distintas que el motor.

import iamModule from '../../../iam';
const { userRepository } = iamModule;
import notificationModule from '../../../notification';
const { notifier } = notificationModule;
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import errorMessageModule from '../../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type DualApprovalConstants from '../../../../shared/domain/constants/dual-approval';
import type { ApprovalRequest } from '../../../../shared/infrastructure/database/generated/prisma/client';


const NOTIF_DUAL_APPROVAL_RESOLVED = 'DUAL_APPROVAL_RESOLVED';

class DualApprovalNotifierService {
  userRepository: typeof userRepository;
  notifier: typeof notifier;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). */
  constructor(deps: DualApprovalNotifierService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  /** Avisa a todos los usuarios activos con un rol aprobador de la operación (fire-and-forget). */
  async notifyApprovers(op: DualApprovalConstants.Op, request: ApprovalRequest, ctx: AdminAuditContext) {
    let approvers: Array<{ userId: string }> = [];
    try {
      approvers = await this.userRepository.findActiveUsersByRoleNames(op.approverRoles);
    } catch (err) {
      logger.warn('[DualApproval] Error buscando aprobadores', { error: errorMessage(err), operationKey: request.operationKey });
      return;
    }

    for (const approver of approvers ?? []) {
      setImmediate(() => {
        this.notifier.notify({
          type: op.notificationType,
          userId: approver.userId,
          relatedEntity: { type: 'ApprovalRequest', id: request.approvalRequestId },
          metadata: {
            approvalRequestId: request.approvalRequestId,
            operationLabel: op.label,
            entityType: request.entityType,
            entityId: request.entityId,
            firstName: ctx.adminFirstName ?? '',
            logoUrl: notifications?.ses?.logoUrl ?? ''
          }
        }).catch(err =>
          logger.warn('[DualApproval] Error notificando aprobador', {
            error: err.message,
            approvalRequestId: request.approvalRequestId
          })
        );
      });
    }
  }

  /** Avisa al solicitante (maker) la decisión tomada sobre su solicitud (fire-and-forget). */
  notifyMaker(request: ApprovalRequest, op: DualApprovalConstants.Op, decision: 'approve' | 'reject') {
    if (!request.requestedBy) {
      return;
    }
    setImmediate(() => {
      this.notifier.notify({
        type: NOTIF_DUAL_APPROVAL_RESOLVED,
        userId: request.requestedBy,
        relatedEntity: { type: 'ApprovalRequest', id: request.approvalRequestId },
        metadata: {
          approvalRequestId: request.approvalRequestId,
          operationLabel: op.label,
          decision,
          logoUrl: notifications?.ses?.logoUrl ?? ''
        }
      }).catch(err =>
        logger.warn('[DualApproval] Error notificando al maker', {
          error: err.message,
          approvalRequestId: request.approvalRequestId
        })
      );
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace DualApprovalNotifierService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    notifier?: typeof notifier;
  }
}

export default DualApprovalNotifierService;
