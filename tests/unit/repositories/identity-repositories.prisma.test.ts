// tests/unit/modules/schemas/kyc/repositories/identity-repositories.prisma.test.ts
//
// Repositorios del grupo 6 (núcleo de identidad) sobre Prisma (docs/prisma-migration.md, fase 5): se
// mockea el cliente único. Incluye los casos que antes cubrían query-encapsulation y
// repositories.regressions con Sequelize (Op.in/notIn de roles, filtros de los atajos del change-log).

const mockDb = {
  $transaction: jest.fn(),
  role: { findMany: jest.fn() },
  user: { findMany: jest.fn(), count: jest.fn(), updateManyAndReturn: jest.fn() },
  auditLog: { findMany: jest.fn(), count: jest.fn() },
  userSession: { updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  userTrustedDevice: { findFirst: jest.fn(), updateManyAndReturn: jest.fn() },
  credentialReset: { updateMany: jest.fn() },
  biometricChallenge: { updateMany: jest.fn() },
  personLocation: { upsert: jest.fn() }
};

jest.mock('../../../src/shared/database/prisma', () => mockDb);

import roleRepository from '../../../src/modules/iam/repositories/role.repository';
import userRepository from '../../../src/modules/iam/repositories/user.repository';
import changeLogRepository from '../../../src/modules/audit/repositories/change-log.repository';
import userSessionRepository from '../../../src/modules/iam/repositories/user-session.repository';
import trustedDeviceRepository from '../../../src/modules/iam/repositories/auth-trusted-device.repository';
import credentialResetRepository from '../../../src/modules/iam/repositories/credential-reset.repository';
import biometricRepositories from '../../../src/modules/iam/repositories/biometric.repository';
import personLocationRepository from '../../../src/modules/person/repositories/person-location.repository';
import HashUtil from '../../../src/shared/security/hash.util';
import { page } from '../../helpers/page';

const { biometricChallengeRepository } = biometricRepositories;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
  mockDb.role.findMany.mockResolvedValue([]);
  mockDb.user.findMany.mockResolvedValue([]);
  mockDb.user.count.mockResolvedValue(0);
  mockDb.auditLog.findMany.mockResolvedValue([]);
  mockDb.auditLog.count.mockResolvedValue(0);
});

describe('RoleRepository.findByNames', () => {
  it('filtra por IN', async () => {
    await roleRepository.findByNames(['cliente']);
    expect(mockDb.role.findMany).toHaveBeenCalledWith({ where: { name: { in: ['cliente'] } } });
  });

  it('con exclude agrega NOT IN', async () => {
    await roleRepository.findByNames(['admin', 'superadmin'], { exclude: ['superadmin'] });
    expect(mockDb.role.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['admin', 'superadmin'], notIn: ['superadmin'] } }
    });
  });
});

describe('ChangeLogRepository (vista sobre audit_logs): filtros', () => {
  const whereOfLastQuery = () => mockDb.auditLog.findMany.mock.calls.at(-1)[0].where;

  it('siempre filtra por la acción USER_FIELD_CHANGED; el usuario afectado es entity_id', async () => {
    await changeLogRepository.findByUserId('user-1', page());
    expect(whereOfLastQuery()).toMatchObject({ action: 'USER_FIELD_CHANGED', entityId: 'user-1' });
  });

  it('findByAdminUser filtra por quién hizo el cambio (user_id) y rol admin (details)', async () => {
    await changeLogRepository.findByAdminUser('admin-1', page());
    expect(whereOfLastQuery()).toMatchObject({
      userId: 'admin-1',
      AND: [{ details: { path: ['changedByRole'], equals: 'admin' } }]
    });
  });

  it('filtra por tipo de cambio en details', async () => {
    await changeLogRepository.findAllPaginated({ changeType: 'email' }, page());
    expect(whereOfLastQuery().AND).toEqual([{ details: { path: ['changeType'], equals: 'email' } }]);
  });
});

describe('UserRepository.findAllPaginated', () => {
  const andOfLastQuery = () => mockDb.user.findMany.mock.calls.at(-1)[0].where.AND;

  it('excluye eliminados por defecto y filtra el documento por su hash (va cifrado)', async () => {
    await userRepository.findAllPaginated({ nationalId: '123' }, page());
    expect(andOfLastQuery()).toEqual(
      expect.arrayContaining([{ deletedAt: null }, { person: { nationalIdHash: HashUtil.hashForSearch('123') } }])
    );
  });

  it('onlyDeleted trae solo eliminados; excludeUserId pisa a userId', async () => {
    await userRepository.findAllPaginated({ onlyDeleted: true, userId: 'u-1', excludeUserId: 'u-2' }, page());
    const and = andOfLastQuery();
    expect(and).toEqual(expect.arrayContaining([{ deletedAt: { not: null } }, { userId: { not: 'u-2' } }]));
    expect(and).not.toContainEqual({ userId: 'u-1' });
  });

  it('busca por username, nombre y apellido sin distinguir mayúsculas', async () => {
    await userRepository.findAllPaginated({}, page(), 'ana');
    const contains = { contains: 'ana', mode: 'insensitive' };
    expect(andOfLastQuery()).toContainEqual({
      OR: [{ username: contains }, { person: { firstName: contains } }, { person: { lastName: contains } }]
    });
  });
});

describe('UserRepository.update', () => {
  it('devuelve null si la fila no existe', async () => {
    mockDb.user.updateManyAndReturn.mockResolvedValue([]);
    await expect(userRepository.update('u-x', { isActive: false })).resolves.toBeNull();
  });

  it('verifyPassword: sin hash guardado nunca coincide', async () => {
    await expect(userRepository.verifyPassword('x', null)).resolves.toBe(false);
  });
});

describe('UserSessionRepository', () => {
  it('closeSession solo cierra si sigue activa y devuelve cuántas cerró', async () => {
    mockDb.userSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(userSessionRepository.closeSession('s-1', 'logout')).resolves.toBe(0);
    expect(mockDb.userSession.updateMany).toHaveBeenCalledWith({
      where: { userSessionId: 's-1', status: 'active' },
      data: expect.objectContaining({ status: 'closed', closeReason: 'logout' })
    });
  });

  it('buildWhere: un estado fuera del enum no devuelve filas (Postgres lo rechazaría)', () => {
    expect(userSessionRepository.buildWhere({ status: 'zzz' })).toEqual({ status: { in: [] } });
    expect(userSessionRepository.buildWhere({ status: 'active', ip: '1.1.1.1' })).toEqual({
      status: 'active',
      ipAddress: '1.1.1.1'
    });
  });
});

describe('TrustedDeviceRepository', () => {
  it('approve lanza 404 si el dispositivo no existe', async () => {
    mockDb.userTrustedDevice.updateManyAndReturn.mockResolvedValue([]);
    await expect(trustedDeviceRepository.approve('d-x', 'd-1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Consumo de un solo uso (token de reset, challenge biométrico)', () => {
  it('markAsUsed del token solo marca si seguía sin usar', async () => {
    mockDb.credentialReset.updateMany.mockResolvedValue({ count: 0 });
    await expect(credentialResetRepository.markAsUsed('rc-1')).resolves.toBe(false);
    expect(mockDb.credentialReset.updateMany).toHaveBeenCalledWith({
      where: { credentialResetId: 'rc-1', used: false },
      data: { used: true, usedAt: expect.any(Date) }
    });
  });

  it('markAsUsed del challenge solo marca si seguía sin usar', async () => {
    mockDb.biometricChallenge.updateMany.mockResolvedValue({ count: 1 });
    await expect(biometricChallengeRepository.markAsUsed('ch-1')).resolves.toBe(true);
    expect(mockDb.biometricChallenge.updateMany).toHaveBeenCalledWith({
      where: { biometricChallengeId: 'ch-1', used: false },
      data: { used: true }
    });
  });
});

describe('PersonLocationRepository.upsertByPersonId', () => {
  it('upsert por person_id (UNIQUE): la actualización no pisa el origen de la captura', async () => {
    const data = { departmentId: 'd-1', cityId: 'c-1', address: 'Calle 1' };
    await personLocationRepository.upsertByPersonId('p-1', data);
    expect(mockDb.personLocation.upsert).toHaveBeenCalledWith({
      where: { personId: 'p-1' },
      create: { personId: 'p-1', ...data },
      update: data
    });
  });
});
