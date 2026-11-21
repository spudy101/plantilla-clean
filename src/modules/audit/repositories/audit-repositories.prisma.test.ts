// tests/unit/modules/schemas/records/audit/repositories/audit-repositories.prisma.test.ts
//
// Repositorios del grupo 5 (auditoría) sobre Prisma (docs/prisma-migration.md, fase 5): se mockea el
// cliente único. Incluye los casos que antes cubrían query-/orm-encapsulation con Sequelize (filtros de
// negocio → WHERE, append-only, retención y purga con SET LOCAL en la misma transacción).

const mockDb = {
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
  auditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), groupBy: jest.fn() },
  auditAlert: { create: jest.fn(), updateMany: jest.fn() },
  userLoginAttempt: { create: jest.fn(), findFirst: jest.fn() },
  user: { findMany: jest.fn() }
};

jest.mock('../../../shared/database/prisma', () => mockDb);

import auditLogRepository from './audit-log.repository';
import auditAlertRepository from './audit-alert.repository';
import userLoginAttemptRepository from './user-login-attempt.repository';
import txContext from '../../../shared/database/transaction-context';
import EncryptionUtil from '../../../shared/security/encryption.util';
import HashUtil from '../../../shared/security/hash.util';
import { page } from 'tests/helpers/page';

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe('AuditLogRepository — filtros de negocio a WHERE', () => {
  it('buildSearchWhere mapea filtros a campos y rango de fechas (ignora lo desconocido)', () => {
    const where = auditLogRepository.buildSearchWhere({
      dateFrom: '2024-01-01',
      dateTo: '2024-02-01',
      action: 'LOGIN',
      userId: 'u-9',
      correlationId: 'c-1',
      module: 'IAM',
      ...({ ignored: 'x' } as object)
    });
    expect(where).toEqual({
      createdAt: { gte: '2024-01-01', lte: '2024-02-01' },
      action: 'LOGIN',
      userId: 'u-9',
      correlationId: 'c-1',
      module: 'IAM'
    });
    expect(auditLogRepository.buildSearchWhere({})).toEqual({});
  });

  it('buildAuthAttemptsWhere: con acciones usa IN y no filtra por categoría; sin acciones, por categoría', () => {
    const from = new Date('2024-01-01');
    const to = new Date('2024-01-31');
    expect(
      auditLogRepository.buildAuthAttemptsWhere({ from, to, actions: ['LOGIN_SUCCESS', 'LOGIN_FAILED'], category: 'Autenticación', userId: 'u-1', outcome: 'failure' })
    ).toEqual({ createdAt: { gte: from, lte: to }, action: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILED'] }, userId: 'u-1', outcome: 'failure' });
    expect(auditLogRepository.buildAuthAttemptsWhere({ from, to, category: 'Autenticación' })).toEqual({
      createdAt: { gte: from, lte: to },
      category: 'Autenticación'
    });
  });

  it('searchPaginated consulta con el WHERE traducido, ordena por el campo pedido (desempate por id) y adjunta el executor', async () => {
    mockDb.auditLog.findMany.mockResolvedValue([{ auditLogId: 'a-1', userId: 'u-1' }, { auditLogId: 'a-2', userId: null }]);
    mockDb.auditLog.count.mockResolvedValue(2);
    mockDb.user.findMany.mockResolvedValue([{ userId: 'u-1', username: 'ana', person: { firstName: 'Ana', lastName: 'P' } }]);

    const { rows, count } = await auditLogRepository.searchPaginated({ action: 'LOGIN' }, page({ sortBy: 'createdAt', order: 'ASC' }));

    expect(mockDb.auditLog.findMany).toHaveBeenCalledWith({
      where: { action: 'LOGIN' },
      take: 10,
      skip: 0,
      orderBy: [{ createdAt: 'asc' }, { auditLogId: 'asc' }]
    });
    expect(count).toBe(2);
    expect(rows[0]?.executor).toMatchObject({ username: 'ana' });
    expect(rows[1]?.executor).toBeNull();
  });

  it('es append-only: no expone update ni delete', () => {
    const repo = auditLogRepository as unknown as Record<string, unknown>;
    expect(repo.update).toBeUndefined();
    expect(repo.delete).toBeUndefined();
  });
});

describe('Auditoría dentro de la transacción del flujo', () => {
  const unitClient = () => ({ auditLog: { create: jest.fn() }, auditAlert: { create: jest.fn() } });

  it('create de audit_logs y audit_alerts usa la transacción de la unidad activa (el cambio y su auditoría, juntos)', async () => {
    const client = unitClient();
    const unit = { prisma: jest.fn().mockResolvedValue(client) };

    await txContext.runInUnit(unit, async () => {
      await auditLogRepository.create({ action: 'X', risk: 'low', outcome: 'success', source: 'http' });
      await auditAlertRepository.create({ action: 'X', risk: 'high' });
    });

    expect(client.auditLog.create).toHaveBeenCalled();
    expect(client.auditAlert.create).toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('independent: escribe con el cliente por defecto aunque haya unidad (intentos fallidos que deben quedar)', async () => {
    const client = unitClient();
    const unit = { prisma: jest.fn().mockResolvedValue(client) };

    await txContext.runInUnit(unit, async () => {
      await auditLogRepository.create({ action: 'X', risk: 'low', outcome: 'failure', source: 'http' }, { independent: true });
      await auditAlertRepository.create({ action: 'X', risk: 'high' }, { independent: true });
    });

    expect(mockDb.auditLog.create).toHaveBeenCalled();
    expect(mockDb.auditAlert.create).toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('AuditLogRepository — retención', () => {
  it('countCreatedUpTo (lte) y countCreatedBefore (lt)', async () => {
    const cutoff = new Date('2021-01-01');
    mockDb.auditLog.count.mockResolvedValue(7);

    await expect(auditLogRepository.countCreatedUpTo(cutoff)).resolves.toBe(7);
    expect(mockDb.auditLog.count).toHaveBeenLastCalledWith({ where: { createdAt: { lte: cutoff } } });
    await auditLogRepository.countCreatedBefore(cutoff);
    expect(mockDb.auditLog.count).toHaveBeenLastCalledWith({ where: { createdAt: { lt: cutoff } } });
  });

  it('purgeCreatedBefore autoriza la purga (SET LOCAL) en la MISMA transacción que el borrado', async () => {
    const cutoff = new Date('2021-01-01');
    mockDb.auditLog.deleteMany.mockResolvedValue({ count: 3 });

    await expect(auditLogRepository.purgeCreatedBefore(cutoff)).resolves.toBe(3);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(String(mockDb.$executeRaw.mock.calls[0]?.[0])).toContain('SET LOCAL app.allow_audit_purge');
    expect(mockDb.auditLog.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: cutoff } } });
  });
});

describe('AuditAlertRepository.acknowledge', () => {
  it('solo reconoce las pendientes y devuelve cuántas cambió', async () => {
    mockDb.auditAlert.updateMany.mockResolvedValue({ count: 0 });
    await expect(auditAlertRepository.acknowledge('al-1', 'admin-1')).resolves.toBe(0);
    expect(mockDb.auditAlert.updateMany).toHaveBeenCalledWith({
      where: { auditAlertId: { in: ['al-1'] }, acknowledged: false },
      data: { acknowledged: true, acknowledgedBy: 'admin-1', acknowledgedAt: expect.any(Date) }
    });
  });
});

describe('UserLoginAttemptRepository', () => {
  it('recordAttempt cifra el documento y guarda su hash de búsqueda', async () => {
    mockDb.userLoginAttempt.create.mockResolvedValue({});
    await userLoginAttemptRepository.recordAttempt({ userId: 'u-1', usernameAttempt: 'ana', nationalId: '123', success: false, failureReason: 'x' });

    const { data } = mockDb.userLoginAttempt.create.mock.calls[0][0];
    expect(data.nationalId).not.toBe('123');
    expect(EncryptionUtil.safeDecrypt(data.nationalId)).toBe('123');
    expect(data.nationalIdHash).toBe(HashUtil.hashForSearch('123'));
    expect(data).toMatchObject({ userId: 'u-1', usernameAttempt: 'ana', success: false, attemptedAt: expect.any(Date) });
  });

  it('checkIfBlocked busca el último intento por hash y devuelve los minutos restantes', async () => {
    mockDb.userLoginAttempt.findFirst.mockResolvedValueOnce({ blockedUntil: new Date(Date.now() + 5 * 60 * 1000) }).mockResolvedValueOnce({ blockedUntil: null });

    await expect(userLoginAttemptRepository.checkIfBlocked('123')).resolves.toMatchObject({ blocked: true, remainingMinutes: 5 });
    await expect(userLoginAttemptRepository.checkIfBlocked('123')).resolves.toBeNull();
    expect(mockDb.userLoginAttempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nationalIdHash: HashUtil.hashForSearch('123') }, orderBy: { attemptedAt: 'desc' } })
    );
  });
});
