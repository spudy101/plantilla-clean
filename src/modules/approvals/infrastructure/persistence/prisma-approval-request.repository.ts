// Adaptador Prisma del puerto ApprovalRequestRepository: las solicitudes de doble aprobación (approval_requests).
// El maker (requester) y el checker (secondApprover) vienen en la misma consulta.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type {
  ApprovalRequestFilters,
  ApprovalRequestPage,
  ApprovalRequestRepository
} from '../../application/ports/approval-request-repository.port';
import type { ApprovalRequest, ApprovalResolution, NewApprovalRequest } from '../../domain/approval-request';
import { ApprovalRequestMapper, WITH_REQUESTER, WITH_USERS } from './approval-request.mapper';

const { toDomain } = ApprovalRequestMapper;

const SEARCH_FIELDS = ['operationKey', 'entityType'];

export class PrismaApprovalRequestRepository extends PrismaRepository implements ApprovalRequestRepository {
  async create(data: NewApprovalRequest): Promise<ApprovalRequest> {
    return toDomain(await (await this.db()).approvalRequest.create({ data: ApprovalRequestMapper.toCreate(data) }));
  }

  async findById(approvalRequestId: string): Promise<ApprovalRequest | null> {
    const row = await (await this.db()).approvalRequest.findUnique({ where: { approvalRequestId }, include: WITH_USERS });
    return row ? toDomain(row) : null;
  }

  async resolve(approvalRequestId: string, { result, ...columns }: ApprovalResolution): Promise<ApprovalRequest | null> {
    const { count } = await (await this.db()).approvalRequest.updateMany({
      where: { approvalRequestId },
      data: {
        ...columns,
        // JSON: null de la columna (DbNull), no el valor JSON null
        ...(result !== undefined ? { result: result === null ? Prisma.DbNull : (result as Prisma.InputJsonValue) } : {})
      }
    });
    return count === 0 ? null : this.findById(approvalRequestId);
  }

  async markExpired(approvalRequestId: string, now: Date): Promise<boolean> {
    const { count } = await (await this.db()).approvalRequest.updateMany({
      where: { approvalRequestId, status: 'pending' },
      data: { status: 'expired', resolvedAt: now }
    });
    return count > 0;
  }

  async list(filters: ApprovalRequestFilters, page: PageRequest, search: string | null): Promise<ApprovalRequestPage> {
    const where = {
      ...(filters.operationKey ? { operationKey: filters.operationKey } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...this.searchWhere(search, SEARCH_FIELDS)
    } as Prisma.ApprovalRequestWhereInput;
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.approvalRequest.findMany({ where, include: WITH_USERS, ...this.paginationArgs(page, 'approvalRequestId') }),
      db.approvalRequest.count({ where })
    ]);
    return { rows: rows.map(toDomain), count };
  }

  async findPendingFor(operationKey: string, entityType: string, entityId: string): Promise<ApprovalRequest | null> {
    const row = await (await this.db()).approvalRequest.findFirst({ where: { operationKey, entityType, entityId, status: 'pending' } });
    return row ? toDomain(row) : null;
  }

  async findPendingByEntityIds(entityType: string, entityIds: string[]): Promise<ApprovalRequest[]> {
    if (entityIds.length === 0) {
      return [];
    }
    const rows = await (await this.db()).approvalRequest.findMany({
      where: { entityType, entityId: { in: entityIds }, status: 'pending' },
      include: WITH_REQUESTER
    });
    return rows.map(toDomain);
  }

  async findExpired(now: Date): Promise<ApprovalRequest[]> {
    const rows = await (await this.db()).approvalRequest.findMany({ where: { status: 'pending', expiresAt: { not: null, lt: now } } });
    return rows.map(toDomain);
  }
}
