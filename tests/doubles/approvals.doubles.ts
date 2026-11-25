// tests/doubles/approvals.doubles.ts
//
// Dobles en memoria de los puertos de approvals, para los tests de los casos de uso.
import type { PageRequest } from '../../src/shared/application/pagination';
import type {
  ApprovalRequestFilters,
  ApprovalRequestRepository
} from '../../src/modules/approvals/application/ports/approval-request-repository.port';
import type { ApproverDirectory } from '../../src/modules/approvals/application/ports/approver-directory.port';
import type { ApprovalThresholds } from '../../src/modules/approvals/application/ports/approval-thresholds.port';
import {
  ApprovalRequest,
  type ApprovalRequestProps,
  type ApprovalResolution,
  type NewApprovalRequest
} from '../../src/modules/approvals/domain/approval-request';

export const MAKER_ID = '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c11';
export const CHECKER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const REQUEST_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const AT = new Date('2026-01-01T00:00:00Z');

export const MAKER_CTX = { adminUserId: MAKER_ID, adminRoleName: 'ADMIN', adminFirstName: 'Ana' };
export const CHECKER_CTX = { adminUserId: CHECKER_ID, adminRoleName: 'ADMIN', adminFirstName: 'Beto' };

export const approvalRequest = (over: Partial<ApprovalRequestProps> = {}) =>
  ApprovalRequest.restore({
    approvalRequestId: REQUEST_ID,
    operationKey: 'RBAC_ROLE_CHANGE',
    entityType: 'User',
    entityId: 'user-9',
    status: 'pending',
    requestedBy: MAKER_ID,
    requester: { userId: MAKER_ID, username: 'ana', firstName: 'Ana', lastName: 'Pérez' },
    requestedAt: AT,
    secondApproverId: null,
    secondApprover: null,
    resolvedAt: null,
    resolutionNotes: null,
    expiresAt: AT,
    payload: { userId: 'user-9', roleId: 'role-2' },
    result: null,
    originSessionId: null,
    createdAt: AT,
    updatedAt: AT,
    ...over
  });

/** Solicitudes en memoria: guarda lo que se creó, cerró y venció. */
export class InMemoryApprovalRequests implements ApprovalRequestRepository {
  readonly created: NewApprovalRequest[] = [];
  readonly resolutions: Array<{ approvalRequestId: string; resolution: ApprovalResolution }> = [];
  readonly listCalls: Array<{ filters: ApprovalRequestFilters; page: PageRequest; search: string | null }> = [];
  readonly pendingLookups: Array<{ entityType: string; entityIds: string[] }> = [];
  /** Ids que ya no estaban pendientes al vencerlas (alguien las resolvió entretanto). */
  readonly alreadyResolved = new Set<string>();
  failMarkExpired = new Set<string>();
  resolveFinds = true;

  constructor(public requests: ApprovalRequest[] = []) {}

  async create(data: NewApprovalRequest) {
    this.created.push(data);
    return approvalRequest({
      approvalRequestId: `ar-${this.created.length}`,
      operationKey: data.operationKey,
      entityType: data.entityType,
      entityId: data.entityId,
      status: data.status,
      requestedBy: data.requestedBy,
      requester: null,
      requestedAt: data.requestedAt,
      secondApproverId: data.secondApproverId ?? null,
      resolvedAt: data.resolvedAt ?? null,
      resolutionNotes: data.resolutionNotes ?? null,
      expiresAt: data.expiresAt,
      payload: data.payload
    });
  }

  async findById(id: string) {
    return this.requests.find(r => r.approvalRequestId === id) ?? null;
  }

  async resolve(approvalRequestId: string, resolution: ApprovalResolution) {
    this.resolutions.push({ approvalRequestId, resolution });
    if (!this.resolveFinds) {
      return null;
    }
    const current = await this.findById(approvalRequestId);
    return current
      ? approvalRequest({
          ...toProps(current),
          status: resolution.status,
          secondApproverId: resolution.secondApproverId,
          resolvedAt: resolution.resolvedAt,
          resolutionNotes: resolution.resolutionNotes,
          result: resolution.result ?? current.result
        })
      : null;
  }

  async markExpired(approvalRequestId: string) {
    if (this.failMarkExpired.has(approvalRequestId)) {
      throw new Error('BD caída');
    }
    return !this.alreadyResolved.has(approvalRequestId);
  }

  async list(filters: ApprovalRequestFilters, page: PageRequest, search: string | null) {
    this.listCalls.push({ filters, page, search });
    return { rows: this.requests, count: this.requests.length };
  }

  async findPendingFor(operationKey: string, entityType: string, entityId: string) {
    return (
      this.requests.find(r => r.status === 'pending' && r.operationKey === operationKey && r.entityType === entityType && r.entityId === entityId) ??
      null
    );
  }

  async findPendingByEntityIds(entityType: string, entityIds: string[]) {
    this.pendingLookups.push({ entityType, entityIds });
    return this.requests.filter(r => r.status === 'pending' && r.entityType === entityType && entityIds.includes(r.entityId ?? ''));
  }

  async findExpired(now: Date) {
    return this.requests.filter(r => r.status === 'pending' && r.expiresAt !== null && r.expiresAt < now);
  }
}

function toProps(r: ApprovalRequest): ApprovalRequestProps {
  return {
    approvalRequestId: r.approvalRequestId,
    operationKey: r.operationKey,
    entityType: r.entityType,
    entityId: r.entityId,
    status: r.status,
    requestedBy: r.requestedBy,
    requester: r.requester,
    requestedAt: r.requestedAt,
    secondApproverId: null,
    secondApprover: r.secondApprover,
    resolvedAt: r.resolvedAt,
    resolutionNotes: r.resolutionNotes,
    expiresAt: r.expiresAt,
    payload: r.payload,
    result: r.result,
    originSessionId: r.originSessionId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

/** Aprobadores fijos (o un error), y anota por qué roles se preguntó. */
export class FixedApprovers implements ApproverDirectory {
  readonly asked: Array<readonly string[]> = [];
  constructor(private readonly result: string[] | Error = []) {}
  async activeUserIdsWithRoles(roleNames: readonly string[]) {
    this.asked.push(roleNames);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

export const noThresholds: ApprovalThresholds = { read: async () => null };
