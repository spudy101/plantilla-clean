// modules/schemas/core/repositories/approval-request.repository.ts
//
// Solicitudes de doble aprobación (maker-checker). Con Prisma, requester y secondApprover se incluyen
// en la misma consulta (en Sequelize, incluir User dos veces con su persona generaba SQL inválido y se
// resolvían aparte).
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { ApprovalRequest, ApprovalRequestStatus } from '../../../shared/database/generated/prisma/client';

// firstName y lastName viven en Person, no en User.
const USER_REF = {
  select: { userId: true, username: true, person: { select: { firstName: true, lastName: true } } }
} satisfies Prisma.UserDefaultArgs;

const WITH_USERS = { requester: USER_REF, secondApprover: USER_REF } satisfies Prisma.ApprovalRequestInclude;
const WITH_REQUESTER = { requester: USER_REF } satisfies Prisma.ApprovalRequestInclude;

export type ApprovalRequestWithUsers = Prisma.ApprovalRequestGetPayload<{ include: typeof WITH_USERS }>;

const SEARCH_FIELDS = ['operationKey', 'entityType'];

class ApprovalRequestRepository extends PrismaRepository {
  async create(data: Prisma.ApprovalRequestUncheckedCreateInput): Promise<ApprovalRequest> {
    return (await this.db()).approvalRequest.create({ data });
  }

  async findByIdWithUsers(approvalRequestId: string): Promise<ApprovalRequestWithUsers | null> {
    return (await this.db()).approvalRequest.findUnique({ where: { approvalRequestId }, include: WITH_USERS });
  }

  /** Cierra una solicitud (aprobada o rechazada) y la devuelve con sus usuarios. Null si no existe. */
  async resolve(approvalRequestId: string, changes: ApprovalRequestRepository.Resolution): Promise<ApprovalRequestWithUsers | null> {
    const { result, ...columns } = changes;
    const { count } = await (await this.db()).approvalRequest.updateMany({
      where: { approvalRequestId },
      data: {
        ...columns,
        // JSON: null de la columna (DbNull), no el valor JSON null
        ...(result !== undefined ? { result: result === null ? Prisma.DbNull : (result as Prisma.InputJsonValue) } : {})
      }
    });
    return count === 0 ? null : this.findByIdWithUsers(approvalRequestId);
  }

  /**
   * Marca como vencida una solicitud que SIGUE pendiente (si alguien la resolvió entre la consulta del
   * worker y este update, no la pisa). Devuelve si la marcó.
   */
  async markExpired(approvalRequestId: string, now: Date): Promise<boolean> {
    const { count } = await (await this.db()).approvalRequest.updateMany({
      where: { approvalRequestId, status: 'pending' },
      data: { status: 'expired', resolvedAt: now }
    });
    return count > 0;
  }

  async findAllPaginatedWithUsers(
    filters: ApprovalRequestRepository.Filters,
    pagination: PageRequest,
    searchTerm: string | null
  ): Promise<PrismaRepository.Page<ApprovalRequestWithUsers>> {
    const where = {
      ...(filters.operationKey ? { operationKey: filters.operationKey } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...this.searchWhere(searchTerm, SEARCH_FIELDS)
    } as Prisma.ApprovalRequestWhereInput;
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.approvalRequest.findMany({ where, include: WITH_USERS, ...this.paginationArgs(pagination, 'approvalRequestId') }),
      db.approvalRequest.count({ where })
    ]);
    return { rows, count };
  }

  async findPendingByEntityOperation(operationKey: string, entityType: string, entityId: string): Promise<ApprovalRequest | null> {
    return (await this.db()).approvalRequest.findFirst({ where: { operationKey, entityType, entityId, status: 'pending' } });
  }

  /** Pendientes de una lista de entidades, con su solicitante (badge en listados de otros módulos). */
  async findPendingByEntityIds(entityType: string, entityIds: string[]) {
    if (!Array.isArray(entityIds) || entityIds.length === 0) {
      return [];
    }
    return (await this.db()).approvalRequest.findMany({
      where: { entityType, entityId: { in: entityIds }, status: 'pending' },
      include: WITH_REQUESTER
    });
  }

  /** Pendientes ya vencidas (para el worker de expiración). */
  async findExpired(now: Date): Promise<ApprovalRequest[]> {
    return (await this.db()).approvalRequest.findMany({ where: { status: 'pending', expiresAt: { not: null, lt: now } } });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ApprovalRequestRepository {
  export interface Filters {
    operationKey?: string;
    status?: ApprovalRequestStatus;
    entityType?: string;
  }

  /** Cierre de una solicitud (resolve). */
  export interface Resolution {
    status: ApprovalRequestStatus;
    secondApproverId: string | null;
    resolvedAt: Date | null;
    resolutionNotes: string | null;
    result?: unknown;
  }
}

export default new ApprovalRequestRepository();
