// Transformaciones de la extensión de Prisma (fase 4 de docs/prisma-migration.md), sin base: cifrado y
// hash al escribir (también anidado), descifrado al leer (también en include), guarda de `where` sobre
// campos cifrados y estampado de origen de sesión. EncryptionUtil y HashUtil son los reales (claves
// dummy de tests/test-env.ts): así se verifica el formato, no un doble.

const mockOrigin = { originSessionId: null as string | null, originCorrelationId: null as string | null };
jest.mock('../observability/request-context.util', () => ({ originFromContext: () => ({ ...mockOrigin }) }));

import ext from './prisma-extensions';
import EncryptionUtil from '../security/encryption.util';
import HashUtil from '../security/hash.util';

const { sealData, openResult, assertWhereSearchable, prepareArgs } = ext;
type Row = Record<string, unknown>;

describe('prisma-extensions · escritura', () => {
  beforeEach(() => {
    mockOrigin.originSessionId = null;
    mockOrigin.originCorrelationId = null;
  });

  it('cifra los campos de PersonContact y completa sus hashes (mismo formato que Sequelize)', () => {
    const data = sealData('PersonContact', { email: 'ana@test.cl', phonePrimary: '+56911112222', personId: 'p-1' }, 'create');

    expect(data.email).not.toBe('ana@test.cl');
    expect(EncryptionUtil.decrypt(data.email as string)).toBe('ana@test.cl');
    expect(data.emailHash).toBe(HashUtil.hashForSearch('ana@test.cl'));
    expect(EncryptionUtil.decrypt(data.phonePrimary as string)).toBe('+56911112222');
    expect(data.phonePrimaryHash).toBe(HashUtil.hashForSearch('+56911112222'));
    expect(data).not.toHaveProperty('phoneSecondary'); // lo que no viene no se toca
    expect(data.personId).toBe('p-1');
  });

  it('no muta el objeto del llamador', () => {
    const original = { nationalId: '12345678' };
    sealData('Person', original, 'create');
    expect(original).toEqual({ nationalId: '12345678' });
  });

  it('update: { set: valor } se cifra igual; null limpia también el hash', () => {
    const viaSet = sealData('Person', { nationalId: { set: '999' } }, 'update');
    expect(EncryptionUtil.decrypt(viaSet.nationalId as string)).toBe('999');
    expect(viaSet.nationalIdHash).toBe(HashUtil.hashForSearch('999'));

    const cleared = sealData('PersonContact', { phoneSecondary: null }, 'update');
    expect(cleared).toEqual({ phoneSecondary: null, phoneSecondaryHash: null });
  });

  it('sigue las escrituras anidadas (create, connectOrCreate, upsert, createMany)', () => {
    const data = sealData(
      'Person',
      {
        firstName: 'Ana',
        contact: { create: { email: 'a@x.cl' } }
      },
      'create'
    );
    const nested = (data.contact as Row).create as Row;
    expect(EncryptionUtil.decrypt(nested.email as string)).toBe('a@x.cl');
    expect(nested.emailHash).toBe(HashUtil.hashForSearch('a@x.cl'));

    const upsert = sealData('Person', { contact: { upsert: { create: { email: 'b@x.cl' }, update: { email: 'c@x.cl' } } } }, 'update');
    const u = (upsert.contact as Row).upsert as Row;
    expect(EncryptionUtil.decrypt((u.create as Row).email as string)).toBe('b@x.cl');
    expect(EncryptionUtil.decrypt((u.update as Row).email as string)).toBe('c@x.cl');

    const args = prepareArgs('UserTrustedDevice', 'createMany', { data: [{ hmacSecret: 's1' }, { hmacSecret: 's2' }] });
    const rows = args!.data as Row[];
    expect(rows.map(r => EncryptionUtil.decrypt(r.hmacSecret as string))).toEqual(['s1', 's2']);
  });

  it('estampa originSessionId/originCorrelationId al crear desde el contexto; un valor explícito gana', () => {
    mockOrigin.originSessionId = 'sess-1';
    mockOrigin.originCorrelationId = 'corr-1';

    expect(sealData('Person', { firstName: 'Ana' }, 'create')).toMatchObject({ originSessionId: 'sess-1', originCorrelationId: 'corr-1' });
    expect(sealData('Person', { originSessionId: 'explicito' }, 'create').originSessionId).toBe('explicito');
    expect(sealData('Person', { firstName: 'Ana' }, 'update')).not.toHaveProperty('originSessionId'); // nunca al actualizar
    expect(sealData('Gender', { name: 'X' }, 'create')).not.toHaveProperty('originSessionId'); // modelo sin la columna
  });
});

describe('prisma-extensions · filtros', () => {
  it('rechaza filtrar por un campo cifrado, también en AND/OR y en filtros de relación', () => {
    expect(() => assertWhereSearchable('PersonContact', { email: 'a@x.cl' })).toThrow(/emailHash/);
    expect(() => assertWhereSearchable('Person', { OR: [{ firstName: 'Ana' }, { nationalId: '1' }] })).toThrow(/nationalIdHash/);
    expect(() => assertWhereSearchable('Person', { contact: { is: { email: 'a@x.cl' } } })).toThrow(/PersonContact\.email/);
    expect(() => assertWhereSearchable('User', { person: { contact: { email: 'a@x.cl' } } })).toThrow();
    expect(() => assertWhereSearchable('PersonContact', { emailHash: 'h' })).not.toThrow();
  });

  it('prepareArgs aplica la guarda a cualquier operación con where', () => {
    expect(() => prepareArgs('PersonContact', 'findFirst', { where: { email: 'a@x.cl' } })).toThrow();
    expect(() => prepareArgs('PersonContact', 'count', { where: { email: 'a@x.cl' } })).toThrow();
  });
});

describe('prisma-extensions · lectura', () => {
  it('descifra la fila y sus include anidados; un valor en claro (legacy) queda igual', () => {
    const row: Row = {
      userId: 'u-1',
      person: {
        nationalId: EncryptionUtil.encrypt('12345678'),
        contact: { email: EncryptionUtil.encrypt('ana@test.cl'), phonePrimary: 'texto-legacy', phoneSecondary: null }
      },
      trustedDevices: [{ hmacSecret: EncryptionUtil.encrypt('secreto') }]
    };

    openResult('User', row);

    const person = row.person as Row;
    expect(person.nationalId).toBe('12345678');
    expect((person.contact as Row).email).toBe('ana@test.cl');
    expect((person.contact as Row).phonePrimary).toBe('texto-legacy');
    expect((person.contact as Row).phoneSecondary).toBeNull();
    expect((row.trustedDevices as Row[])[0]!.hmacSecret).toBe('secreto');
  });

  it('acepta listas, null y resultados que no son filas', () => {
    const rows = [{ email: EncryptionUtil.encrypt('a@x.cl') }, { email: EncryptionUtil.encrypt('b@x.cl') }];
    expect(openResult('PersonContact', rows)).toEqual([{ email: 'a@x.cl' }, { email: 'b@x.cl' }]);
    expect(openResult('PersonContact', null)).toBeNull();
    expect(openResult('PersonContact', 3)).toBe(3);
  });
});
