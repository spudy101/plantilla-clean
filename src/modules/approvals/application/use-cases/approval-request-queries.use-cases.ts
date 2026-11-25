// Casos de uso de lectura del panel admin de doble aprobación (cada consulta queda auditada):
//
//   ListApprovalRequests   la cola paginada, con filtros por operación, estado y entidad
//   GetApprovalRequest     el detalle, con el payload propuesto y el resultado
//   GetApprovalPolicy      qué operaciones están gateadas y con qué condición
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import { pageOf, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { ApprovalStatus } from '../../domain/approval-request';
import { isThresholdOperation, operations, ttlHoursOf } from '../../domain/dual-approval-operation';
import { ApprovalRequestNotFoundError } from '../../domain/errors';
import type { ApprovalRequestRepository } from '../ports/approval-request-repository.port';
import type { ApprovalThresholds } from '../ports/approval-thresholds.port';
import {
  toApprovalRequestListItem,
  toApprovalRequestOutput,
  type ApprovalPolicyOutput,
  type PolicyEntryOutput
} from '../dto/approval-request.output';
import { currentThreshold } from './approval-thresholds';
import { APPROVAL_AUDIT_ENTITY } from './approvals-audit';

export type ApprovalListQuery = PageQuery & {
  search?: string | null;
  operationKey?: string;
  status?: ApprovalStatus;
  entityType?: string;
};

export class ListApprovalRequests {
  constructor(
    private readonly requests: ApprovalRequestRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ApprovalListQuery }) {
    const page = pageRequest(query);
    const filters = { operationKey: query.operationKey, status: query.status, entityType: query.entityType };
    const { rows, count } = await this.requests.list(filters, page, query.search ?? null);
    const result = pageOf(rows.map(toApprovalRequestListItem), page, count, { search: query.search, ...filters });

    await this.audit.record('APPROVAL_REQUEST_LIST_VIEWED', {
      actorId,
      details: { operationKey: query.operationKey ?? null, status: query.status ?? null },
      ...APPROVAL_AUDIT_ENTITY
    });
    return result;
  }
}

export class GetApprovalRequest {
  constructor(
    private readonly requests: ApprovalRequestRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, approvalRequestId }: { actorId: string; approvalRequestId: string }) {
    const request = await this.requests.findById(approvalRequestId);
    if (!request) {
      throw new ApprovalRequestNotFoundError();
    }
    await this.audit.record('APPROVAL_REQUEST_VIEWED', { actorId, entityId: approvalRequestId, ...APPROVAL_AUDIT_ENTITY });
    return toApprovalRequestOutput(request);
  }
}

export class GetApprovalPolicy {
  constructor(
    private readonly thresholds: ApprovalThresholds,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ actorId }: { actorId: string }): Promise<ApprovalPolicyOutput> {
    const entries = await Promise.all(
      operations().map(async ([operationKey, op]) => {
        const entry: PolicyEntryOutput = {
          operationKey,
          label: op.label,
          condition: op.condition,
          approverRoles: op.approverRoles,
          entityType: op.entityType,
          ttlHours: ttlHoursOf(op)
        };
        if (isThresholdOperation(op)) {
          entry.thresholdField = op.thresholdField;
          entry.threshold = await currentThreshold(op, this.thresholds, this.logger);
        }
        return entry;
      })
    );

    await this.audit.record('APPROVAL_POLICY_VIEWED', { actorId, ...APPROVAL_AUDIT_ENTITY });
    // `enabled` se conserva en el contrato (el front lo lee), pero el maker-checker no se puede apagar
    return { enabled: true, operations: entries };
  }
}
