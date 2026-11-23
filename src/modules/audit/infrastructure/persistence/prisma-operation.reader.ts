// Adaptador del puerto OperationReader con el repositorio de operaciones de shared/infrastructure (la tabla
// operations la escribe el middleware/runOperation; audit solo la lee).
import operationRepository from '../../../../shared/infrastructure/observability/operation.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { OperationFilters, OperationReader } from '../../application/ports/operation-reader.port';
import type { Page } from '../../application/ports/audit-log-repository.port';
import type { OperationEntry } from '../../domain/operation';
import { AuditMapper } from './audit.mapper';

type OperationRepository = Pick<typeof operationRepository, 'findAllPaginated' | 'findById' | 'findChildren'>;

export class PrismaOperationReader implements OperationReader {
  constructor(private readonly operations: OperationRepository = operationRepository) {}

  async list(filters: OperationFilters, page: PageRequest): Promise<Page<OperationEntry>> {
    const { rows, count } = await this.operations.findAllPaginated(filters, page);
    return { rows: rows.map(AuditMapper.operationToDomain), count };
  }

  async findById(operationId: string): Promise<OperationEntry | null> {
    const row = await this.operations.findById(operationId);
    return row ? AuditMapper.operationToDomain(row) : null;
  }

  async findChildren(operationId: string): Promise<OperationEntry[]> {
    return (await this.operations.findChildren(operationId)).map(AuditMapper.operationToDomain);
  }
}
