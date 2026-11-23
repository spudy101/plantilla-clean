// Puerto: el contexto de la operación en curso (quién, desde dónde, en qué operación) y si hay una unidad de
// trabajo abierta. Lo implementa infrastructure/context/operation-context.adapter.ts con el contexto de
// shared/infrastructure (AsyncLocalStorage).
import type { OperationOrigin } from '../../domain/audit-log';

export interface OperationContext {
  origin(): OperationOrigin;
  /** true si la escritura corre dentro de una unidad de trabajo (si falla, el flujo se revierte con ella). */
  insideUnitOfWork(): boolean;
}
