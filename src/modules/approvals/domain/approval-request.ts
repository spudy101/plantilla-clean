// Una solicitud de doble aprobación (approval_requests): la operación que un funcionario (maker) dejó pendiente y
// que un segundo funcionario (checker) aprueba o rechaza. El "estado doble aprobación" de cualquier módulo vive acá:
// no se duplican columnas ni máquina de estados por tabla.
import { ApprovalRequestNotPendingError, ApproverIsMakerError } from './errors';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type ResolutionDecision = 'approve' | 'reject';

/** Un usuario de la solicitud (maker o checker), con los nombres de su persona. */
export interface ApprovalUserRef {
  userId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface ApprovalRequestProps {
  approvalRequestId: string;
  operationKey: string;
  entityType: string | null;
  entityId: string | null;
  status: ApprovalStatus;
  requestedBy: string;
  /** null cuando la lectura no trae los usuarios (la solicitud recién creada). */
  requester: ApprovalUserRef | null;
  requestedAt: Date | null;
  secondApproverId: string | null;
  secondApprover: ApprovalUserRef | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  expiresAt: Date | null;
  payload: unknown;
  result: unknown;
  originSessionId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export class ApprovalRequest {
  private constructor(private readonly props: ApprovalRequestProps) {}

  static restore(props: ApprovalRequestProps): ApprovalRequest {
    return new ApprovalRequest({ ...props });
  }

  get approvalRequestId() {
    return this.props.approvalRequestId;
  }
  get operationKey() {
    return this.props.operationKey;
  }
  get entityType() {
    return this.props.entityType;
  }
  get entityId() {
    return this.props.entityId;
  }
  get status() {
    return this.props.status;
  }
  get requestedBy() {
    return this.props.requestedBy;
  }
  get requester() {
    return this.props.requester;
  }
  get requestedAt() {
    return this.props.requestedAt;
  }
  get secondApprover() {
    return this.props.secondApprover;
  }
  get resolvedAt() {
    return this.props.resolvedAt;
  }
  get resolutionNotes() {
    return this.props.resolutionNotes;
  }
  get expiresAt() {
    return this.props.expiresAt;
  }
  get payload() {
    return this.props.payload;
  }
  get result() {
    return this.props.result;
  }
  get originSessionId() {
    return this.props.originSessionId;
  }
  get createdAt() {
    return this.props.createdAt;
  }
  get updatedAt() {
    return this.props.updatedAt;
  }

  /** Solo una pendiente se resuelve: aprobada, rechazada o vencida ya no cambia. */
  assertPending(): void {
    if (this.props.status !== 'pending') {
      throw new ApprovalRequestNotPendingError(this.props.status);
    }
  }

  /** Segregación de funciones: el checker no puede ser el maker. */
  assertNotRequestedBy(approverUserId: string): void {
    if (this.props.requestedBy === approverUserId) {
      throw new ApproverIsMakerError();
    }
  }
}

/** Lo que se guarda al abrir una solicitud. */
export interface NewApprovalRequest {
  operationKey: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  requestedBy: string;
  requestedAt: Date;
  status: ApprovalStatus;
  expiresAt: Date | null;
  /** Solo la auto-aprobación de super_admin nace resuelta. */
  secondApproverId?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
}

/** El cierre de una solicitud (aprobada o rechazada). */
export interface ApprovalResolution {
  status: 'approved' | 'rejected';
  secondApproverId: string;
  resolvedAt: Date;
  resolutionNotes: string | null;
  /** Solo al aprobar: lo que devolvió la reanudación. */
  result?: unknown;
}

export const AUTO_APPROVE_NOTE = 'Auto-aprobado por super_admin (cuatro ojos omitido por rol)';

/** Solicitud abierta por un super_admin: queda aprobada por él mismo (traza completa: maker === checker). */
export function autoApprovedRequest(base: Omit<NewApprovalRequest, 'status' | 'expiresAt' | 'requestedAt'>, now: Date): NewApprovalRequest {
  return {
    ...base,
    requestedAt: now,
    status: 'approved',
    secondApproverId: base.requestedBy,
    resolvedAt: now,
    resolutionNotes: AUTO_APPROVE_NOTE,
    expiresAt: null
  };
}

/** Lo que se guarda en `result`: solo datos serializables (sin referencias ni ciclos); null si no se puede. */
export function storableResult(result: unknown): unknown {
  if (result === null || result === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return null;
  }
}
