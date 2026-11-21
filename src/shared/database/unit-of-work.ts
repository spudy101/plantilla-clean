// shared/database/unit-of-work.ts
//
// ============================================================
// UNIT OF WORK — puerto de transacciones (SOLID: D, Dependency Inversion)
// ============================================================
// Los services y casos de uso NO conocen el ORM: cuando necesitan atomicidad piden una unidad de
// trabajo. Todo lo que pasa dentro de `work` se confirma junto o se revierte junto:
//
//   const user = await this.unitOfWork.run(async () => {
//     const user = await this.userRepository.create(data);
//     await this.personContactRepository.create({ personId: user.personId, … });
//     return user;
//   });
//   logAudit(…);  // lo que va DESPUÉS del commit, fuera de run()
//
// `run()` abre una transacción interactiva de Prisma y la publica en transaction-context: los
// repositorios (PrismaRepository#db) la toman solos, así el service no la pasa por cada llamada. Si
// `work` lanza, Prisma revierte; si no, confirma.
//
// Un `run()` dentro de otro se une a la unidad activa (no abre otra).
// No hay `begin()` manual: con commit/rollback a mano el contexto no se propaga a quien llama, y
// Prisma no tiene transacciones manuales.
//
// CONFLICTOS: si Postgres aborta la transacción por deadlock o serialización (otra transacción tocó lo
// mismo), `run()` la repite COMPLETA, desde cero, hasta MAX_ATTEMPTS veces con un backoff corto y
// aleatorio. Es seguro porque el rollback deshizo todo lo de la base, incluida la auditoría de éxito
// (que se escribe en la misma transacción). Lo único que no se deshace es lo que salió afuera: si
// `work` llamó a un proveedor externo (callProvider marca la unidad), NO se repite y el conflicto se
// propaga (409 TRANSACTION_CONFLICT temporal: reintenta el cliente). Regla de siempre: lo externo va
// después del commit, fuera de run().
// ============================================================
import { interopDefault } from '../utils/interop.util';
import type { Prisma } from './generated/prisma/client';
import txContext from './transaction-context';
import type { ActiveUnit } from './transaction-context';
import { isTransactionConflict } from './database-errors';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;

/** Lo que el Unit of Work necesita del cliente de Prisma (inyectable en tests). */
interface PrismaTransactional {
  $transaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }
  ): Promise<R>;
}

// Prisma corta una transacción interactiva a los 5 s por defecto; los flujos con bcrypt + varias
// escrituras pueden acercarse. maxWait: cuánto esperar una conexión libre del pool.
const PRISMA_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

// Intentos ante un conflicto (deadlock / serialización), incluido el primero. Backoff: base·2^(n-1) más
// un aleatorio, para que las dos transacciones que chocaron no vuelvan a chocar en el mismo instante.
const MAX_ATTEMPTS = 3;
const CONFLICT_BACKOFF_BASE_MS = 20;

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

class PrismaUnitOfWork implements PrismaUnitOfWork.Port {
  private readonly _prisma: PrismaTransactional | null;

  /**
   * @param deps.prisma Cliente. Si no se pasa, se resuelve de forma perezosa (`shared/database/prisma`),
   *   así el mock de test sobre ese módulo aplica y importar el puerto no crea el cliente.
   */
  constructor({ prisma }: { prisma?: PrismaTransactional } = {}) {
    this._prisma = prisma ?? null;
  }

  private _client(): PrismaTransactional {
    return this._prisma ?? (interopDefault(require('./prisma') as typeof import('./prisma')) as unknown as PrismaTransactional);
  }

  /**
   * Ejecuta `work` dentro de una unidad de trabajo (commit/rollback automáticos). Ante un deadlock o un
   * error de serialización la repite completa (ver arriba), salvo que haya tenido efectos externos.
   */
  async run<T>(work: () => PromiseLike<T>, options: PrismaUnitOfWork.Options = {}): Promise<T> {
    if (txContext.activeUnit()) {
      return work();
    }
    for (let attempt = 1; ; attempt++) {
      const unit: ActiveUnit = { prisma: () => Promise.reject(new Error('unidad sin abrir')) };
      try {
        return await this._attempt(unit, work, options);
      } catch (error) {
        if (!isTransactionConflict(error) || unit.externalEffects || attempt >= MAX_ATTEMPTS) {
          throw error;
        }
        const delayMs = CONFLICT_BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * CONFLICT_BACKOFF_BASE_MS);
        logger.warn('[UnitOfWork] Conflicto de transacción: se repite completa', { attempt, maxAttempts: MAX_ATTEMPTS, delayMs });
        await sleep(delayMs);
      }
    }
  }

  private _attempt<T>(unit: ActiveUnit, work: () => PromiseLike<T>, options: PrismaUnitOfWork.Options): Promise<T> {
    return this._client().$transaction(
      async tx => {
        unit.prisma = () => Promise.resolve(tx);
        try {
          return await txContext.runInUnit(unit, work);
        } finally {
          // Lo que `work` dejó programado en segundo plano ya no se une a esta unidad
          unit.closed = true;
        }
      },
      { ...PRISMA_TX_OPTIONS, ...options }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PrismaUnitOfWork {
  export interface Options {
    isolationLevel?: Prisma.TransactionIsolationLevel;
    timeout?: number;
  }

  /**
   * Contrato que cualquier implementación de Unit of Work debe respetar (SOLID: L).
   * Los services dependen de este puerto, no del ORM.
   */
  export interface Port {
    run<T>(work: () => PromiseLike<T>, options?: Options): Promise<T>;
  }
}

// Instancia por defecto + la clase (tests y composición), igual que el resto de los services.
const unitOfWork = Object.assign(new PrismaUnitOfWork(), { PrismaUnitOfWork });

export default unitOfWork;
