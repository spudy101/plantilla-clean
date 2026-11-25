// Caso de uso: el gate de la doble aprobación. Decide si una operación de otro módulo necesita un segundo
// funcionario; si lo necesita, abre la solicitud (pending), avisa a los aprobadores y la operación queda en espera
// (la ejecuta después el handler registrado, al aprobar). Si no, la operación sigue de inmediato.
//
// super_admin omite los cuatro ojos: la solicitud se crea ya aprobada por él mismo (traza completa) y la acción la
// ejecuta el flujo normal; el handler NO se invoca acá para no ejecutarla dos veces.
import type { AdminAuditContext } from '../../../../shared/application/audit-context';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import { autoApprovedRequest } from '../../domain/approval-request';
import { expiresAtFor, isSuperAdmin, operationOf, requiresApproval } from '../../domain/dual-approval-operation';
import { ApprovalAlreadyPendingError } from '../../domain/errors';
import type { ApprovalRequestRepository } from '../ports/approval-request-repository.port';
import type { ApprovalThresholds } from '../ports/approval-thresholds.port';
import { toApprovalRequestOutput, type GateOutput } from '../dto/approval-request.output';
import type { ApprovalNotices } from './approval-notices';
import { currentThreshold } from './approval-thresholds';
import { APPROVAL_AUDIT_ENTITY } from './approvals-audit';

export interface GateInput {
  /** Default: la entidad que declara la operación en el registro. */
  entityType?: string | null;
  entityId?: string | null;
  /** Lo que el handler recibe al aprobar. */
  payload?: unknown;
  ctx: AdminAuditContext;
}

export class GateOperation {
  constructor(
    private readonly requests: ApprovalRequestRepository,
    private readonly thresholds: ApprovalThresholds,
    private readonly notices: ApprovalNotices,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute(operationKey: string, { entityType, entityId, payload, ctx }: GateInput): Promise<GateOutput> {
    const op = operationOf(operationKey);

    if (!requiresApproval(op, payload, await currentThreshold(op, this.thresholds, this.logger))) {
      return { pending: false };
    }

    const resolvedEntityType = entityType ?? op.entityType ?? null;

    // Una sola pendiente por (operación, entidad): refuerza el índice único parcial
    if (resolvedEntityType && entityId) {
      const existing = await this.requests.findPendingFor(operationKey, resolvedEntityType, entityId);
      if (existing) {
        throw new ApprovalAlreadyPendingError(existing.approvalRequestId);
      }
    }

    const base = {
      operationKey,
      entityType: resolvedEntityType,
      entityId: entityId ?? null,
      payload: payload ?? {},
      requestedBy: ctx.adminUserId
    };
    const auditDetails = { operationKey, entityType: resolvedEntityType, entityId: entityId ?? null };

    if (isSuperAdmin(ctx?.adminRoleName)) {
      const request = await this.requests.create(autoApprovedRequest(base, new Date()));
      const entry = {
        actorId: ctx.adminUserId,
        details: { approvalRequestId: request.approvalRequestId, ...auditDetails },
        entityId: request.approvalRequestId,
        ...APPROVAL_AUDIT_ENTITY
      };
      await this.audit.record('DUAL_APPROVAL_REQUESTED', entry);
      await this.audit.record('DUAL_APPROVAL_AUTO_APPROVED', entry);
      return { pending: false, autoApproved: true, request: toApprovalRequestOutput(request) };
    }

    const expiresAt = expiresAtFor(op, new Date());
    // origin_session_id = la sesión del MAKER (la completa la extensión de Prisma). El checker resuelve en otra
    // sesión, que queda en audit_logs.
    const request = await this.requests.create({ ...base, requestedAt: new Date(), status: 'pending', expiresAt });

    // Sin esperar: buscar a los aprobadores no demora la respuesta
    void this.notices.notifyApprovers(op, request, ctx);

    await this.audit.record('DUAL_APPROVAL_REQUESTED', {
      actorId: ctx.adminUserId,
      details: { approvalRequestId: request.approvalRequestId, ...auditDetails, expiresAt },
      entityId: request.approvalRequestId,
      ...APPROVAL_AUDIT_ENTITY
    });

    return { pending: true, request: toApprovalRequestOutput(request) };
  }
}
