// Tabla `idempotency_keys`. Escribe SIEMPRE con el cliente independiente: la clave no puede quedar dentro
// de la transacción de negocio (si esta se revierte, la clave igual tiene que reflejar qué pasó).
import PrismaRepository from '../../database/prisma.repository';
import type { IdempotencyKey, Prisma } from '../../database/generated/prisma/client';

const UNIQUE_VIOLATION = 'P2002';

class IdempotencyRepository extends PrismaRepository {
  /**
   * Reclama la clave: inserta la fila en curso. Atómico contra la PK (scope, clave): de dos peticiones
   * simultáneas con la misma clave, gana una sola. false si ya existía.
   */
  async claim(data: { scope: string; key: string; requestHash: string; lockedUntil: Date; expiresAt: Date }): Promise<boolean> {
    try {
      await this.independentDb().idempotencyKey.create({ data: { ...data, status: 'in_progress' } });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        return false;
      }
      throw error;
    }
  }

  find(scope: string, key: string): Promise<IdempotencyKey | null> {
    return this.independentDb().idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
  }

  /**
   * Retoma una clave en curso cuyo plazo venció (la petición dueña no terminó: proceso caído, timeout).
   * Atómico: el WHERE exige que siga vencida, así de dos que intentan retomarla gana una.
   */
  async takeOver(scope: string, key: string, lockedUntil: Date): Promise<boolean> {
    const { count } = await this.independentDb().idempotencyKey.updateMany({
      where: { scope, key, status: 'in_progress', lockedUntil: { lt: new Date() } },
      data: { lockedUntil }
    });
    return count === 1;
  }

  /** Guarda la respuesta definitiva: desde acá, los reintentos con esta clave la reciben tal cual. */
  async complete(scope: string, key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    await this.independentDb().idempotencyKey.updateMany({
      where: { scope, key, status: 'in_progress' },
      data: { status: 'completed', responseStatus, responseBody: responseBody as Prisma.InputJsonValue, lockedUntil: null }
    });
  }

  /** Libera la clave (el resultado fue temporal): el próximo reintento con ella se ejecuta de nuevo. */
  async release(scope: string, key: string): Promise<void> {
    await this.independentDb().idempotencyKey.deleteMany({ where: { scope, key, status: 'in_progress' } });
  }

  /** Borra la fila de una clave vencida, para que se pueda reclamar de nuevo. */
  async deleteIfExpired(scope: string, key: string): Promise<void> {
    await this.independentDb().idempotencyKey.deleteMany({ where: { scope, key, expiresAt: { lt: new Date() } } });
  }

  /** Retención: borra las claves vencidas. */
  async purgeExpired(before: Date = new Date()): Promise<number> {
    const { count } = await this.independentDb().idempotencyKey.deleteMany({ where: { expiresAt: { lt: before } } });
    return count;
  }
}

export default Object.assign(new IdempotencyRepository(), { IdempotencyRepository });
