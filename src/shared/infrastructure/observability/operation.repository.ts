// shared/observability/operation.repository.ts
//
// Tabla `operations`: una fila por operación. Escribe con el cliente independiente (nunca dentro de la
// transacción de negocio: la traza queda aunque el flujo se revierta).
import PrismaRepository from '../database/prisma.repository';
import type { PageRequest } from '../../application/pagination';
import type { Operation, OperationSource, OperationStatus, Prisma } from '../database/generated/prisma/client';

class OperationRepository extends PrismaRepository {
  start(data: Pick<Prisma.OperationUncheckedCreateInput, 'operationId' | 'parentId' | 'clientRequestId' | 'source' | 'name' | 'ip'>) {
    return this.independentDb().operation.create({ data });
  }

  finish(
    operationId: string,
    data: Pick<
      Prisma.OperationUncheckedUpdateInput,
      'source' | 'name' | 'userId' | 'sessionId' | 'status' | 'httpStatus' | 'errorCode' | 'errorMessage' | 'endedAt' | 'durationMs'
    >
  ) {
    return this.independentDb().operation.update({ where: { operationId }, data });
  }

  findById(operationId: string): Promise<Operation | null> {
    return this.independentDb().operation.findUnique({ where: { operationId } });
  }

  findChildren(parentId: string): Promise<Operation[]> {
    return this.independentDb().operation.findMany({ where: { parentId }, orderBy: { startedAt: 'asc' } });
  }

  async findAllPaginated(
    { source, status, userId, name, from, to }: OperationRepository.Filters = {},
    pagination: PageRequest
  ): Promise<PrismaRepository.Page<Operation>> {
    const where: Prisma.OperationWhereInput = {
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
      ...(userId ? { userId } : {}),
      ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}),
      ...(from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
    };
    const db = this.independentDb();
    const [rows, count] = await Promise.all([
      db.operation.findMany({ where, ...this.paginationArgs(pagination, 'operationId') }),
      db.operation.count({ where })
    ]);
    return { rows, count };
  }

  /** Retención: borra las operaciones que empezaron antes de `before`. */
  async purgeOlderThan(before: Date): Promise<number> {
    const { count } = await this.independentDb().operation.deleteMany({ where: { startedAt: { lt: before } } });
    return count;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace OperationRepository {
  interface Filters {
    source?: OperationSource;
    status?: OperationStatus;
    userId?: string;
    name?: string;
    from?: Date;
    to?: Date;
  }
}

export default Object.assign(new OperationRepository(), { OperationRepository });
