// Mapper fila de approval_requests (con o sin sus usuarios) ↔ entidad ApprovalRequest.
import type {
  Prisma,
  ApprovalRequest as ApprovalRequestRow,
  ApprovalRequestStatus
} from '../../../../shared/infrastructure/database/generated/prisma/client';
import { ApprovalRequest, type ApprovalStatus, type ApprovalUserRef, type NewApprovalRequest } from '../../domain/approval-request';

// firstName y lastName viven en Person, no en User.
export const USER_REF = {
  select: { userId: true, username: true, person: { select: { firstName: true, lastName: true } } }
} satisfies Prisma.UserDefaultArgs;

export const WITH_USERS = { requester: USER_REF, secondApprover: USER_REF } satisfies Prisma.ApprovalRequestInclude;
export const WITH_REQUESTER = { requester: USER_REF } satisfies Prisma.ApprovalRequestInclude;

type UserRefRow = Prisma.UserGetPayload<typeof USER_REF>;

/** La fila, con los usuarios que haya traído la consulta. */
export type ApprovalRequestRecord = ApprovalRequestRow & { requester?: UserRefRow | null; secondApprover?: UserRefRow | null };

// Los estados del dominio son los del enum de la base: si uno cambia, esto no compila
const STATUS: Record<ApprovalRequestStatus, ApprovalStatus> = { pending: 'pending', approved: 'approved', rejected: 'rejected', expired: 'expired' };

const userRef = (user: UserRefRow | null | undefined): ApprovalUserRef | null =>
  user
    ? { userId: user.userId, username: user.username ?? null, firstName: user.person?.firstName ?? null, lastName: user.person?.lastName ?? null }
    : null;

export const ApprovalRequestMapper = {
  toDomain(row: ApprovalRequestRecord): ApprovalRequest {
    return ApprovalRequest.restore({
      approvalRequestId: row.approvalRequestId,
      operationKey: row.operationKey,
      entityType: row.entityType,
      entityId: row.entityId,
      status: STATUS[row.status],
      requestedBy: row.requestedBy,
      requester: userRef(row.requester),
      requestedAt: row.requestedAt,
      secondApproverId: row.secondApproverId,
      secondApprover: userRef(row.secondApprover),
      resolvedAt: row.resolvedAt,
      resolutionNotes: row.resolutionNotes,
      expiresAt: row.expiresAt,
      payload: row.payload,
      result: row.result,
      originSessionId: row.originSessionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  },

  toCreate(data: NewApprovalRequest): Prisma.ApprovalRequestUncheckedCreateInput {
    return {
      operationKey: data.operationKey,
      entityType: data.entityType,
      entityId: data.entityId,
      payload: data.payload as Prisma.InputJsonValue,
      requestedBy: data.requestedBy,
      requestedAt: data.requestedAt,
      status: data.status,
      ...(data.secondApproverId !== undefined ? { secondApproverId: data.secondApproverId } : {}),
      ...(data.resolvedAt !== undefined ? { resolvedAt: data.resolvedAt } : {}),
      ...(data.resolutionNotes !== undefined ? { resolutionNotes: data.resolutionNotes } : {}),
      expiresAt: data.expiresAt
    };
  }
};
