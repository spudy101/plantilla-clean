// tests/unit/repositories/identity-repositories.prisma.test.ts
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
  personLocation: { upsert: jest.fn() },
  userLoginAttempt: { create: jest.fn(), findFirst: jest.fn() }
};

jest.mock('../../../src/shared/infrastructure/database/prisma', () => mockDb);

import { PrismaRoleRepository } from '../../../src/modules/iam/infrastructure/persistence/prisma-role.repository';
import { PrismaUserRepository } from '../../../src/modules/iam/infrastructure/persistence/prisma-user.repository';
import { PrismaChangeLogRepository } from '../../../src/modules/audit/infrastructure/persistence/prisma-change-log.repository';
import { PrismaUserSessionRepository } from '../../../src/modules/iam/infrastructure/persistence/prisma-user-session.repository';
import { PrismaTrustedDeviceRepository } from '../../../src/modules/iam/infrastructure/persistence/prisma-trusted-device.repository';
import { PrismaCredentialResetRepository } from '../../../src/modules/iam/infrastructure/persistence/prisma-credential-reset.repository';
import { PrismaBiometricChallengeRepository } from '../../../src/modules/iam/infrastructure/persistence/prisma-biometric.repositories';
import { PrismaLoginAttemptRepository } from '../../../src/modules/iam/infrastructure/persistence/prisma-login-attempt.repository';
import { bcryptPasswordHasher } from '../../../src/modules/iam/infrastructure/security/security.adapters';
import { DeviceNotFoundError } from '../../../src/modules/iam/domain/errors';
import { PrismaPersonLocationRepository } from '../../../src/modules/person/infrastructure/persistence/prisma-person-location.repository';
import EncryptionUtil from '../../../src/shared/infrastructure/security/encryption.util';
import HashUtil from '../../../src/shared/infrastructure/security/hash.util';
import { page } from '../../helpers/page';

const roleRepository = new PrismaRoleRepository();
const userRepository = new PrismaUserRepository();
const userSessionRepository = new PrismaUserSessionRepository();
const trustedDeviceRepository = new PrismaTrustedDeviceRepository();
const credentialResetRepository = new PrismaCredentialResetRepository();
const biometricChallengeRepository = new PrismaBiometricChallengeRepository();
const loginAttemptRepository = new PrismaLoginAttemptRepository();

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

describe('PrismaChangeLogRepository (vista sobre audit_logs): filtros', () => {
  const changeLogRepository = new PrismaChangeLogRepository();
  const whereOfLastQuery = () => mockDb.auditLog.findMany.mock.calls.at(-1)[0].where;

  it('siempre filtra por la acción USER_FIELD_CHANGED; el usuario afectado es entity_id', async () => {
    await changeLogRepository.list({ userId: 'user-1' }, page(), null);
    expect(whereOfLastQuery()).toMatchObject({ action: 'USER_FIELD_CHANGED', entityId: 'user-1' });
  });

  it('filtra por quién hizo el cambio (user_id) y su rol (details)', async () => {
    await changeLogRepository.list({ changedByUserId: 'admin-1', changedByRole: 'admin' }, page(), null);
    expect(whereOfLastQuery()).toMatchObject({
      userId: 'admin-1',
      AND: [{ details: { path: ['changedByRole'], equals: 'admin' } }]
    });
  });

  it('filtra por tipo de cambio en details', async () => {
    await changeLogRepository.list({ changeType: 'email' }, page(), null);
    expect(whereOfLastQuery().AND).toEqual([{ details: { path: ['changeType'], equals: 'email' } }]);
  });
});

describe('PrismaUserRepository.list', () => {
  const andOfLastQuery = () => mockDb.user.findMany.mock.calls.at(-1)[0].where.AND;

  it('excluye eliminados por defecto y filtra el documento por su hash (va cifrado)', async () => {
    await userRepository.list({ nationalId: '123' }, page(), null);
    expect(andOfLastQuery()).toEqual(
      expect.arrayContaining([{ deletedAt: null }, { person: { nationalIdHash: HashUtil.hashForSearch('123') } }])
    );
  });

  it('onlyDeleted trae solo eliminados; excludeUserId pisa a userId', async () => {
    await userRepository.list({ onlyDeleted: true, userId: 'u-1', excludeUserId: 'u-2' }, page(), null);
    const and = andOfLastQuery();
    expect(and).toEqual(expect.arrayContaining([{ deletedAt: { not: null } }, { userId: { not: 'u-2' } }]));
    expect(and).not.toContainEqual({ userId: 'u-1' });
  });

  it('busca por username, nombre y apellido sin distinguir mayúsculas', async () => {
    await userRepository.list({}, page(), 'ana');
    const contains = { contains: 'ana', mode: 'insensitive' };
    expect(andOfLastQuery()).toContainEqual({
      OR: [{ username: contains }, { person: { firstName: contains } }, { person: { lastName: contains } }]
    });
  });
});

describe('PrismaUserRepository.update', () => {
  it('devuelve null si la fila no existe', async () => {
    mockDb.user.updateManyAndReturn.mockResolvedValue([]);
    await expect(userRepository.update('u-x', { isActive: false })).resolves.toBeNull();
  });

  it('la contraseña: sin hash guardado nunca coincide', async () => {
    await expect(bcryptPasswordHasher.matches('x', null)).resolves.toBe(false);
  });
});

describe('PrismaUserSessionRepository', () => {
  it('close solo cierra si sigue activa y devuelve cuántas cerró', async () => {
    mockDb.userSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(userSessionRepository.close('s-1', 'logout')).resolves.toBe(0);
    expect(mockDb.userSession.updateMany).toHaveBeenCalledWith({
      where: { userSessionId: 's-1', status: 'active' },
      data: expect.objectContaining({ status: 'closed', closeReason: 'logout' })
    });
  });

  it('listado admin: un estado fuera del enum no devuelve filas (Postgres lo rechazaría)', async () => {
    mockDb.userSession.findMany.mockResolvedValue([]);
    mockDb.userSession.count.mockResolvedValue(0);
    const whereOfLastQuery = () => mockDb.userSession.findMany.mock.calls.at(-1)[0].where;
    await userSessionRepository.findPaginatedWithDeviceAndUser({ status: 'zzz' }, page());
    expect(whereOfLastQuery()).toEqual({ status: { in: [] } });
    await userSessionRepository.findPaginatedWithDeviceAndUser({ status: 'active', ip: '1.1.1.1' }, page());
    expect(whereOfLastQuery()).toEqual({ status: 'active', ipAddress: '1.1.1.1' });
  });
});

describe('PrismaTrustedDeviceRepository', () => {
  it('approve rechaza si el dispositivo no existe (404)', async () => {
    mockDb.userTrustedDevice.updateManyAndReturn.mockResolvedValue([]);
    await expect(trustedDeviceRepository.approve('d-x', 'd-1')).rejects.toBeInstanceOf(DeviceNotFoundError);
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

describe('PrismaPersonLocationRepository.save', () => {
  it('upsert por person_id (UNIQUE): la actualización no pisa el origen de la captura', async () => {
    const data = { departmentId: 'd-1', cityId: 'c-1', address: 'Calle 1' };
    await new PrismaPersonLocationRepository().save('p-1', data);
    expect(mockDb.personLocation.upsert).toHaveBeenCalledWith({
      where: { personId: 'p-1' },
      create: { personId: 'p-1', ...data },
      update: data
    });
  });
});

describe('PrismaLoginAttemptRepository', () => {
  it('record cifra el documento y guarda su hash de búsqueda', async () => {
    mockDb.userLoginAttempt.create.mockResolvedValue({});
    await loginAttemptRepository.record({ userId: 'u-1', usernameAttempt: 'ana', nationalId: '123', success: false, failureReason: 'x' });

    const { data } = mockDb.userLoginAttempt.create.mock.calls[0][0];
    expect(data.nationalId).not.toBe('123');
    expect(EncryptionUtil.safeDecrypt(data.nationalId)).toBe('123');
    expect(data.nationalIdHash).toBe(HashUtil.hashForSearch('123'));
    expect(data).toMatchObject({ userId: 'u-1', usernameAttempt: 'ana', success: false, attemptedAt: expect.any(Date) });
  });

  it('findBlock busca el último intento por hash y devuelve los minutos restantes', async () => {
    mockDb.userLoginAttempt.findFirst
      .mockResolvedValueOnce({ blockedUntil: new Date(Date.now() + 5 * 60 * 1000) })
      .mockResolvedValueOnce({ blockedUntil: null });
    await expect(loginAttemptRepository.findBlock('123')).resolves.toMatchObject({ blocked: true, remainingMinutes: 5 });
    await expect(loginAttemptRepository.findBlock('123')).resolves.toBeNull();
    expect(mockDb.userLoginAttempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nationalIdHash: HashUtil.hashForSearch('123') }, orderBy: { attemptedAt: 'desc' } })
    );
  });
});
