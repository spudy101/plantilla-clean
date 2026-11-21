// Contra Postgres real: los errores de la base que no son culpa de la petición llegan con la forma que
// reconoce shared/database/database-errors.ts. Un mock no prueba esto: la forma la decide la cadena
// pg → @prisma/adapter-pg → Prisma, y cambia entre versiones.
//   - base inalcanzable          → isDatabaseUnavailable (→ 503)
//   - pool agotado (timeout)     → isDatabaseUnavailable (→ 503)
//   - deadlock entre dos tx      → isTransactionConflict, y con unitOfWork.run se resuelve repitiendo la abortada

import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/shared/database/generated/prisma/client';
import prisma from '../../src/shared/database/prisma';
import constantsModule from '../../src/shared/constants';
import { isDatabaseUnavailable, isTransactionConflict } from '../../src/shared/database/database-errors';
import unitOfWork from '../../src/shared/database/unit-of-work';
import txContext from '../../src/shared/database/transaction-context';

const { database } = constantsModule;
const TAG = `dberr-it-${randomUUID().slice(0, 8)}`;

function clientWith(poolOverrides: Record<string, unknown>) {
  const adapter = new PrismaPg(
    {
      host: database.host,
      port: database.port,
      database: database.name,
      user: database.user,
      password: database.password,
      ...poolOverrides
    },
    { schema: database.schema }
  );
  return new PrismaClient({ adapter });
}

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e
  );

describe('Errores de la base · Postgres real', () => {
  it('base inalcanzable (puerto cerrado) → no disponible', async () => {
    const client = clientWith({ port: 1, connectionTimeoutMillis: 2_000 });
    try {
      const err = await errorOf(client.$queryRaw`SELECT 1`);
      expect(err).not.toBeNull();
      expect(isDatabaseUnavailable(err)).toBe(true);
      expect(isTransactionConflict(err)).toBe(false);
    } finally {
      await client.$disconnect();
    }
  });

  it('pool agotado: vence connectionTimeoutMillis → no disponible', async () => {
    // connectionTimeoutMillis cubre también ABRIR la conexión: bajo carga (suites en paralelo) abrir la
    // primera puede tardar varios cientos de ms, así que el margen no puede ser mínimo.
    const client = clientWith({ max: 1, connectionTimeoutMillis: 2_000 });
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    let signalAcquired!: () => void;
    const acquired = new Promise<void>(resolve => {
      signalAcquired = resolve;
    });
    try {
      // Una transacción toma la única conexión y la retiene. Se espera a que la tenga de verdad (con un
      // tiempo fijo, bajo carga la segunda consulta podía ganar la conexión y el test fallaba a veces).
      const holder = client
        .$transaction(
          async tx => {
            await tx.$queryRaw`SELECT 1`;
            signalAcquired();
            await held;
          },
          { timeout: 15_000 }
        )
        .finally(signalAcquired); // si no pudo tomar la conexión, que el test falle sin colgarse
      await acquired;
      const err = await errorOf(client.$queryRaw`SELECT 1`);
      release();
      await holder;
      expect(err).not.toBeNull();
      expect(isDatabaseUnavailable(err)).toBe(true);
    } finally {
      release();
      await client.$disconnect();
    }
  }, 20_000);

  describe('deadlock', () => {
    const roleIds: string[] = [];

    beforeAll(async () => {
      for (const n of [1, 2]) {
        roleIds.push((await prisma.role.create({ data: { name: `${TAG}-${n}` } })).roleId);
      }
    });

    afterAll(async () => {
      await prisma.role.deleteMany({ where: { roleId: { in: roleIds } } });
    });

    it('dos transacciones que bloquean filas en orden opuesto → conflicto de transacción', async () => {
      const [a, b] = roleIds as [string, string];
      // Cada una bloquea su primera fila, espera a que la otra haga lo mismo y va por la segunda
      let lockedCount = 0;
      let bothLocked!: () => void;
      const barrier = new Promise<void>(resolve => {
        bothLocked = resolve;
      });
      const lockThenCross = (first: string, second: string) =>
        prisma.$transaction(
          async tx => {
            await tx.role.update({ where: { roleId: first }, data: { description: 'lock' } });
            lockedCount += 1;
            if (lockedCount === 2) {
              bothLocked();
            }
            await barrier;
            await tx.role.update({ where: { roleId: second }, data: { description: 'cross' } });
          },
          { timeout: 10_000 }
        );

      const results = await Promise.allSettled([lockThenCross(a, b), lockThenCross(b, a)]);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      // Postgres aborta una de las dos (deadlock_detected) y la otra confirma
      expect(failed).toHaveLength(1);
      expect(isTransactionConflict(failed[0]!.reason)).toBe(true);
      expect(isDatabaseUnavailable(failed[0]!.reason)).toBe(false);
    });

    it('con unitOfWork.run el mismo deadlock se resuelve solo: la abortada se repite y las dos confirman', async () => {
      const [a, b] = roleIds as [string, string];
      let lockedCount = 0;
      let bothLocked!: () => void;
      const barrier = new Promise<void>(resolve => {
        bothLocked = resolve;
      });
      const attempts = { ab: 0, ba: 0 };
      // Solo el PRIMER intento de cada una espera a la otra: el reintento ya no tiene con quién chocar
      const lockThenCross = (first: string, second: string, label: 'ab' | 'ba') =>
        unitOfWork.run(
          async () => {
            attempts[label] += 1;
            const db = await txContext.activeUnit()!.prisma();
            await db.role.update({ where: { roleId: first }, data: { description: `${label}-1` } });
            if (attempts[label] === 1) {
              lockedCount += 1;
              if (lockedCount === 2) {
                bothLocked();
              }
              await barrier;
            }
            await db.role.update({ where: { roleId: second }, data: { description: `${label}-2` } });
            return label;
          },
          { timeout: 10_000 }
        );

      const results = await Promise.all([lockThenCross(a, b, 'ab'), lockThenCross(b, a, 'ba')]);

      expect(results).toEqual(['ab', 'ba']);
      // Una de las dos se repitió (la que Postgres eligió abortar)
      expect(attempts.ab + attempts.ba).toBe(3);
    });
  });
});
