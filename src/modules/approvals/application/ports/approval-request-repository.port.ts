// Puerto de persistencia de las solicitudes de doble aprobación (approval_requests). Lo implementa
// infrastructure/persistence/prisma-approval-request.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ApprovalRequest, ApprovalResolution, ApprovalStatus, NewApprovalRequest } from '../../domain/approval-request';

/** Filtros del listado admin; ausente = sin ese filtro. */
export interface ApprovalRequestFilters {
  operationKey?: string;
  status?: ApprovalStatus;
  entityType?: string;
}

export interface ApprovalRequestPage {
  rows: ApprovalRequest[];
  count: number;
}

export interface ApprovalRequestRepository {
  /** La solicitud recién creada, sin sus usuarios (requester y secondApprover en null). */
  create(data: NewApprovalRequest): Promise<ApprovalRequest>;

  /** Con el maker y el checker. */
  findById(approvalRequestId: string): Promise<ApprovalRequest | null>;

  /** Cierra la solicitud y la devuelve con sus usuarios; null si no existe. */
  resolve(approvalRequestId: string, resolution: ApprovalResolution): Promise<ApprovalRequest | null>;

  /** Marca vencida una solicitud que SIGUE pendiente (no pisa una que alguien resolvió entretanto). */
  markExpired(approvalRequestId: string, now: Date): Promise<boolean>;

  /** Página del listado admin, con el maker y el checker de cada solicitud. */
  list(filters: ApprovalRequestFilters, page: PageRequest, search: string | null): Promise<ApprovalRequestPage>;

  findPendingFor(operationKey: string, entityType: string, entityId: string): Promise<ApprovalRequest | null>;

  /** Las pendientes de esas entidades, con su maker (el badge de los listados de otros módulos). */
  findPendingByEntityIds(entityType: string, entityIds: string[]): Promise<ApprovalRequest[]>;

  /** Pendientes con el vencimiento ya pasado. */
  findExpired(now: Date): Promise<ApprovalRequest[]>;
}
