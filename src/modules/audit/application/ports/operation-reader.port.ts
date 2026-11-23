// Puerto de lectura de la traza de operaciones (tabla operations, la escribe shared/infrastructure). Lo
// implementa infrastructure/persistence/prisma-operation.reader.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { OperationEntry, OperationSource, OperationStatus } from '../../domain/operation';
import type { Page } from './audit-log-repository.port';

export interface OperationFilters {
  source?: OperationSource;
  status?: OperationStatus;
  userId?: string;
  /** Parte del nombre (sin distinguir mayúsculas). */
  name?: string;
  from?: Date;
  to?: Date;
}

export interface OperationReader {
  list(filters: OperationFilters, page: PageRequest): Promise<Page<OperationEntry>>;
  findById(operationId: string): Promise<OperationEntry | null>;
  /** Operaciones que originó esta, en orden. */
  findChildren(operationId: string): Promise<OperationEntry[]>;
}
