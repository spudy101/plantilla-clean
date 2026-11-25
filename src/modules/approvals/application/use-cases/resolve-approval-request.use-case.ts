// Caso de uso: el segundo funcionario (checker) aprueba o rechaza una solicitud. Al aprobar se ejecuta la
// reanudación registrada de la operación y se guarda lo que devolvió; al rechazar, la reacción opcional.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { storableResult, type ApprovalRequest, type ApprovalResolution, type ResolutionDecision } from '../../domain/approval-request';
import { assertCanResolve, operationOf, type DualApprovalOperation } from '../../domain/dual-approval-operation';
import { ApprovalRequestNotFoundError, InvalidResolutionDecisionError, NoApprovalHandlerError } from '../../domain/errors';
import type { ApprovalRequestRepository } from '../ports/approval-request-repository.port';
import { toApprovalRequestOutput } from '../dto/approval-request.output';
import type { ApprovalHandlers } from './approval-handlers';
import type { ApprovalNotices } from './approval-notices';
import { APPROVAL_AUDIT_ENTITY } from './approvals-audit';

export interface ResolveApprovalInput {
  approvalRequestId: string;
  decision: string;
  notes?: string | null;
  ctx: AdminAuditContext;
}

const AUDIT_ACTION: Record<ResolutionDecision, string> = { approve: 'DUAL_APPROVAL_APPROVED', reject: 'DUAL_APPROVAL_REJECTED' };

export class ResolveApprovalRequest {
  constructor(
    private readonly requests: ApprovalRequestRepository,
    private readonly handlers: ApprovalHandlers,
    private readonly notices: ApprovalNotices,
    private readonly audit: AuditTrail
  ) {}

  async execute({ approvalRequestId, decision, notes, ctx }: ResolveApprovalInput) {
    const request = await this.requests.findById(approvalRequestId);
    if (!request) {
      throw new ApprovalRequestNotFoundError();
    }
    request.assertPending();

    const op = operationOf(request.operationKey);
    assertCanResolve(op, ctx.adminRoleName);
    request.assertNotRequestedBy(ctx.adminUserId);

    if (decision === 'approve') {
      return this.approve(request, op, notes ?? null, ctx);
    }
    if (decision === 'reject') {
      return this.reject(request, op, notes ?? null, ctx);
    }
    throw new InvalidResolutionDecisionError();
  }

  private async approve(request: ApprovalRequest, op: DualApprovalOperation, notes: string | null, ctx: AdminAuditContext) {
    const entry = this.handlers.find(request.operationKey);
    if (!entry) {
      throw new NoApprovalHandlerError(request.operationKey);
    }

    // El handler es idempotente: si falla lo que sigue, la solicitud queda pendiente y se puede reintentar sin
    // ejecutar dos veces
    const result = await entry.onApprove(request.payload, ctx);

    return this.close(request, op, 'approve', ctx, {
      status: 'approved',
      secondApproverId: ctx.adminUserId,
      resolvedAt: new Date(),
      resolutionNotes: notes,
      result: storableResult(result)
    });
  }

  private async reject(request: ApprovalRequest, op: DualApprovalOperation, notes: string | null, ctx: AdminAuditContext) {
    const onReject = this.handlers.find(request.operationKey)?.onReject;
    if (onReject) {
      await onReject(request.payload, ctx);
    }

    return this.close(request, op, 'reject', ctx, {
      status: 'rejected',
      secondApproverId: ctx.adminUserId,
      resolvedAt: new Date(),
      resolutionNotes: notes
    });
  }

  /** Guarda el cierre, avisa al maker y lo audita. */
  private async close(
    request: ApprovalRequest,
    op: DualApprovalOperation,
    decision: ResolutionDecision,
    ctx: AdminAuditContext,
    resolution: ApprovalResolution
  ) {
    const resolved = await this.requests.resolve(request.approvalRequestId, resolution);
    if (!resolved) {
      throw new ApprovalRequestNotFoundError(false);
    }

    this.notices.notifyMaker(resolved, op, decision);

    await this.audit.record(AUDIT_ACTION[decision], {
      actorId: ctx.adminUserId,
      details: {
        approvalRequestId: request.approvalRequestId,
        operationKey: request.operationKey,
        entityType: request.entityType,
        entityId: request.entityId
      },
      entityId: request.approvalRequestId,
      ...APPROVAL_AUDIT_ENTITY
    });

    return toApprovalRequestOutput(resolved);
  }
}
