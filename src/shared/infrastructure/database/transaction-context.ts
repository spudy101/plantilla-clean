// Unidad de trabajo activa de la petición en curso, en AsyncLocalStorage. `unitOfWork.run()` la abre y
// la publica acá; los repositorios la toman solos (PrismaRepository#db), así un service no pasa la
// transacción por cada llamada.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from './generated/prisma/client';

export interface ActiveUnit {
  /** Cliente de la transacción interactiva de Prisma. */
  prisma(): Promise<Prisma.TransactionClient>;
  /**
   * true cuando el trabajo de la unidad ya terminó (antes del commit/rollback). El AsyncLocalStorage
   * sigue visible para lo que se programó adentro (setImmediate, promesas sueltas): eso no debe usar
   * una transacción que ya se cerró, así que deja de ser activa.
   */
  closed?: boolean;
  /**
   * true si dentro de la unidad se llamó a un proveedor externo (email, SMS, S3…). Eso no se revierte con
   * el rollback: el Unit of Work no repite una unidad así ante un conflicto (duplicaría el envío).
   */
  externalEffects?: boolean;
}

const storage = new AsyncLocalStorage<ActiveUnit>();

/** La unidad de trabajo en curso, o null fuera de `unitOfWork.run()`. */
export function activeUnit(): ActiveUnit | null {
  const unit = storage.getStore();
  return unit && !unit.closed ? unit : null;
}

/** Marca la unidad activa (si hay) como con efectos externos. Lo llama callProvider. */
export function markExternalEffect(): void {
  const unit = activeUnit();
  if (unit) {
    unit.externalEffects = true;
  }
}

/** Ejecuta `fn` con `unit` como unidad activa (solo lo usa el Unit of Work). */
export function runInUnit<T>(unit: ActiveUnit, fn: () => T): T {
  return storage.run(unit, fn);
}

export default { activeUnit, runInUnit, markExternalEffect };
