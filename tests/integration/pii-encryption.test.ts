// tests/integration/pii-encryption.test.ts
//
// Cifrado de PII de la extensión de Prisma (shared/database/prisma-extensions.ts) contra Postgres real
// (esquema aislado de tests/test-env.ts; `npm run db:test:prepare`): en la base va cifrado y con su hash
// de búsqueda, los repositorios leen en claro (también en include y dentro del Unit of Work), y un dato
// legado guardado en claro se sigue leyendo.

import { randomUUID } from 'node:crypto';
import prisma from '../../src/shared/infrastructure/database/prisma';
import { hashValue, sealValue } from '../../src/shared/infrastructure/database/pii-fields';
import requestContext from '../../src/shared/infrastructure/observability/request-context.util';
import constants from '../../src/shared/infrastructure/config';
import unitOfWork from '../../src/shared/infrastructure/database/unit-of-work';
import txContext from '../../src/shared/infrastructure/database/transaction-context';

const SCHEMA = constants.database.schema;

const uniq = () => randomUUID().replace(/-/g, '').slice(0, 10);
const created: string[] = [];

/** Lo guardado en la base, sin pasar por la extensión. */
async function storedContact(personId: string) {
  const rows = await prisma.$queryRawUnsafe<
    { email: string; email_hash: string; phone_primary: string | null; phone_primary_hash: string | null }[]
  >(
    `SELECT email, email_hash, phone_primary, phone_primary_hash FROM "${SCHEMA}".person_contacts WHERE person_id = $1::uuid`,
    personId
  );
  return rows[0]!;
}

describe('PII · cifrado de la extensión de Prisma contra Postgres', () => {
  afterAll(async () => {
    if (created.length) await prisma.person.deleteMany({ where: { personId: { in: created } } });
    await prisma.$disconnect();
  });

  it('una escritura anidada guarda cifrado + hash y se lee en claro (también en include)', async () => {
    const email = `prisma-${uniq()}@test.cl`;
    const nationalId = uniq();
    const person = await prisma.person.create({
      data: { firstName: 'Bea', lastName: 'Prisma', nationalId, contact: { create: { email, phonePrimary: '+56933334444' } } }
    });
    created.push(person.personId);

    // lo devuelto por create también sale descifrado
    expect(person.nationalId).toBe(nationalId);

    const stored = await storedContact(person.personId);
    expect(stored.email).not.toBe(email); // en la base va cifrado
    expect(stored.email_hash).toBe(hashValue(email));
    expect(stored.phone_primary_hash).toBe(hashValue('+56933334444'));

    const read = await prisma.person.findUnique({ where: { personId: person.personId }, include: { contact: true } });
    expect(read?.nationalId).toBe(nationalId);
    expect(read?.nationalIdHash).toBe(hashValue(nationalId));
    expect(read?.contact?.email).toBe(email);
    expect(read?.contact?.phonePrimary).toBe('+56933334444');
  });

  it('un valor cifrado fuera de la extensión (sealValue) se lee igual que uno propio', async () => {
    const email = `sealed-${uniq()}@test.cl`;
    const person = await prisma.person.create({ data: { firstName: 'Ana', lastName: 'Sealed' } });
    created.push(person.personId);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${SCHEMA}".person_contacts (person_contact_id, person_id, email, email_hash, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, now(), now())`,
      randomUUID(),
      person.personId,
      sealValue(email),
      hashValue(email)
    );

    const found = await prisma.personContact.findFirst({ where: { emailHash: hashValue(email) } });
    expect(found?.email).toBe(email);
  });

  it('se busca por hash (no por el valor cifrado) y filtrar por el campo cifrado es un error', async () => {
    const email = `hash-${uniq()}@test.cl`;
    const person = await prisma.person.create({ data: { firstName: 'Caro', lastName: 'Hash', contact: { create: { email } } } });
    created.push(person.personId);

    const found = await prisma.personContact.findFirst({ where: { emailHash: hashValue(email) } });
    expect(found?.email).toBe(email);
    await expect(prisma.personContact.findFirst({ where: { email } })).rejects.toThrow(/emailHash/);
  });

  it('al crear dentro de una request estampa originSessionId y originCorrelationId', async () => {
    const sessionId = randomUUID();
    const person = await requestContext.run(
      {
        correlationId: 'corr-pii-test',
        name: 'test',
        ip: null,
        userAgent: null,
        fingerprintHash: null,
        method: null,
        path: null,
        source: 'http',
        sessionId
      },
      // await DENTRO del contexto: las consultas de Prisma son perezosas y corren al esperarlas
      // eslint-disable-next-line no-return-await -- el await tiene que correr DENTRO del contexto
      async () => await prisma.person.create({ data: { firstName: 'Dani', lastName: 'Origen' } })
    );
    created.push(person.personId);

    expect(person.originSessionId).toBe(sessionId);
    expect(person.originCorrelationId).toBe('corr-pii-test');
  });

  it('dentro de unitOfWork.run() el cliente de la transacción también cifra y descifra', async () => {
    const email = `uow-${uniq()}@test.cl`;
    const person = await unitOfWork.run(async () => {
      const tx = await txContext.activeUnit()!.prisma();
      return tx.person.create({
        data: { firstName: 'Eva', lastName: 'Tx', contact: { create: { email } } },
        include: { contact: true }
      });
    });
    created.push(person.personId);

    expect(person.contact?.email).toBe(email); // lo devuelto, descifrado
    const stored = await storedContact(person.personId);
    expect(stored.email).not.toBe(email); // en la base, cifrado
    expect(stored.email_hash).toBe(hashValue(email));
  });
});
