// tests/integration/unit-of-work.test.ts
//
// Unit of Work contra Postgres real (esquema aislado de tests/test-env.ts; `npm run db:test:prepare`).
// Dentro de unitOfWork.run() las escrituras se confirman juntas o se revierten juntas, los repositorios
// toman solos la transacción del contexto (PrismaRepository#db) y desde afuera no se ve nada a medias.

import { randomUUID } from 'node:crypto';
import unitOfWork from '../../src/shared/infrastructure/database/unit-of-work';
import txContext from '../../src/shared/infrastructure/database/transaction-context';
import prisma from '../../src/shared/infrastructure/database/prisma';
import { PrismaGenderRepository } from '../../src/modules/catalogs/infrastructure/persistence/prisma-gender.repository';

const genderRepository = new PrismaGenderRepository();

const PREFIX = `uow-it-${randomUUID().slice(0, 8)}`;

async function namesInDb(): Promise<string[]> {
  const rows = await prisma.gender.findMany({ where: { name: { startsWith: PREFIX } }, orderBy: { name: 'asc' } });
  return rows.map(r => r.name);
}

async function txClient() {
  return txContext.activeUnit()!.prisma();
}

describe('Unit of Work contra Postgres', () => {
  afterEach(async () => {
    await prisma.gender.deleteMany({ where: { name: { startsWith: PREFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('confirma juntas las escrituras del trabajo', async () => {
    await unitOfWork.run(async () => {
      await (await txClient()).gender.create({ data: { name: `${PREFIX}-a` } });
      await (await txClient()).gender.create({ data: { name: `${PREFIX}-b` } });
    });

    expect(await namesInDb()).toEqual([`${PREFIX}-a`, `${PREFIX}-b`]);
  });

  it('si el trabajo lanza, no queda ninguna', async () => {
    await expect(
      unitOfWork.run(async () => {
        await (await txClient()).gender.create({ data: { name: `${PREFIX}-a` } });
        await (await txClient()).gender.create({ data: { name: `${PREFIX}-b` } });
        throw new Error('regla de negocio');
      })
    ).rejects.toThrow('regla de negocio');

    expect(await namesInDb()).toEqual([]);
  });

  it('un repositorio dentro de run() ve lo escrito en la transacción; desde afuera no se ve hasta el commit', async () => {
    let seenByRepository = false;
    let seenOutside: string[] = ['sin consultar'];
    await unitOfWork.run(async () => {
      await (await txClient()).gender.create({ data: { name: `${PREFIX}-pendiente` } });
      seenByRepository = await genderRepository.exists({ name: `${PREFIX}-pendiente` }); // toma la transacción del contexto
      seenOutside = await namesInDb(); // cliente único: otra conexión, fuera de la transacción
    });

    expect(seenByRepository).toBe(true);
    expect(seenOutside).toEqual([]);
    expect(await namesInDb()).toEqual([`${PREFIX}-pendiente`]);
  });
});
