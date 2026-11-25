// Lo que devuelven los casos de uso de approvals (datos planos, keys en camelCase). El orden de las keys es el
// que respondía la plantilla en capas.
import type { ApprovalRequest, ApprovalUserRef } from '../../domain/approval-request';

const userRef = (user: ApprovalUserRef | null) =>
  user ? { userId: user.userId, username: user.username, firstName: user.firstName, lastName: user.lastName } : null;

/** El detalle (y la solicitud que devuelve el gate o la resolución), con payload y result. */
export function toApprovalRequestOutput(request: ApprovalRequest) {
  return {
    approvalRequestId: request.approvalRequestId,
    operationKey: request.operationKey,
    entityType: request.entityType,
    entityId: request.entityId,
    status: request.status,
    requestedBy: userRef(request.requester),
    requestedAt: request.requestedAt,
    secondApprover: userRef(request.secondApprover),
    resolvedAt: request.resolvedAt,
    resolutionNotes: request.resolutionNotes,
    expiresAt: request.expiresAt,
    payload: request.payload ?? null,
    result: request.result ?? null,
    // Sesión del maker que abrió la solicitud. Solo en el detalle; el listado no la lleva.
    originSessionId: request.originSessionId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt
  };
}
export type ApprovalRequestOutput = ReturnType<typeof toApprovalRequestOutput>;

/** Item del listado: sin payload ni result (más liviano). */
export function toApprovalRequestListItem(request: ApprovalRequest) {
  return {
    approvalRequestId: request.approvalRequestId,
    operationKey: request.operationKey,
    entityType: request.entityType,
    entityId: request.entityId,
    status: request.status,
    requestedBy: userRef(request.requester),
    requestedAt: request.requestedAt,
    secondApprover: userRef(request.secondApprover),
    resolvedAt: request.resolvedAt,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt
  };
}

/** La pendiente que se anota en los listados de otros módulos (badge). */
export function toPendingApprovalOutput(request: ApprovalRequest) {
  return {
    approvalRequestId: request.approvalRequestId,
    operationKey: request.operationKey,
    status: request.status,
    requestedBy: userRef(request.requester),
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt
  };
}
export type PendingApprovalOutput = ReturnType<typeof toPendingApprovalOutput>;

/** Una operación gateada, como la ve el front. */
export interface PolicyEntryOutput {
  operationKey: string;
  label: string;
  condition: 'always' | 'threshold';
  approverRoles: string[];
  entityType: string;
  ttlHours: number;
  thresholdField?: string;
  threshold?: number;
}

export interface ApprovalPolicyOutput {
  /** Siempre true: el maker-checker no se puede apagar (se conserva porque el front lo lee). */
  enabled: true;
  operations: PolicyEntryOutput[];
}

/** Resultado del gate: pendiente (la acción espera al checker) o sigue de inmediato. */
export type GateOutput =
  | { pending: true; request: ApprovalRequestOutput }
  | { pending: false; autoApproved: true; request: ApprovalRequestOutput }
  | { pending: false };
