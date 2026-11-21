// tests/integration/audit.test.ts
//
// Grupo 5 de la fase 5 (docs/prisma-migration.md) contra Postgres real: auditoría sobre Prisma.
// Cubre lo que un mock no prueba: el trigger append-only de audit_logs (y la purga autorizada con SET
// LOCAL dentro de la transacción de Prisma), que la auditoría quede aunque la unidad de trabajo que la
// disparó se revierta, el groupBy por sesión y el bloqueo de login por hash del documento.

import { randomUUID } from 'node:crypto';
import prisma from '../../src/shared/database/prisma';
import unitOfWork from '../../src/shared/database/unit-of-work';
import auditLogRepository from '../../src/modules/audit/repositories/audit-log.repository';
import auditAlertRepository from '../../src/modules/audit/repositories/audit-alert.repository';
import userLoginAttemptRepository from '../../src/modules/audit/repositories/user-login-attempt.repository';
import audit from '../../src/modules/audit/audit.service';
import requestContext from '../../src/shared/observability/request-context.util';
import { page } from '../helpers/page';

const TAG = `audit-it-${randomUUID().slice(0, 8)}`;
const SESSION_A = randomUUID();
const SESSION_B = randomUUID();
let roleId: string;
let personId: string;
let userId: string;

const base = { risk: 'low' as const, outcome: 'success' as const, source: 'http', module: TAG };

describe('Auditoría · Prisma contra Postgres', () => {
  beforeAll(async () => {
    roleId = (await prisma.role.create({ data: { name: TAG } })).roleId;
    personId = (await prisma.person.create({ data: { firstName: 'Ana', lastName: TAG } })).personId;
    userId = (await prisma.user.create({ data: { username: TAG, personId, roleId } })).userId;
  });

  afterAll(async () => {
    // audit_logs es append-only: la limpieza usa la misma vía autorizada que la purga
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'true'`;
      await tx.auditLog.deleteMany({ where: { OR: [{ module: TAG }, { correlationId: { startsWith: TAG } }] } });
    });
    await prisma.auditAlert.deleteMany({ where: { OR: [{ action: TAG }, { userId }] } });
    await prisma.userLoginAttempt.deleteMany({ where: { usernameAttempt: TAG } });
    await prisma.user.deleteMany({ where: { userId } });
    await prisma.person.deleteMany({ where: { personId } });
    await prisma.role.deleteMany({ where: { roleId } });
    await prisma.$disconnect();
  });

  // audit.record dentro de una operación con correlationId propio, para contar solo lo de cada caso
  const inOperation = <T>(id: string, fn: () => Promise<T>) =>
    requestContext.run(
      { correlationId: `${TAG}-${id}`, source: 'http', name: 'test', ip: null, userAgent: null, fingerprintHash: null, method: null, path: null },
      fn
    );
  const countFor = (id: string) => prisma.auditLog.count({ where: { correlationId: `${TAG}-${id}` } });

  it('un hecho de negocio se revierte junto con la unidad de trabajo (el cambio y su auditoría, juntos o ninguno)', async () => {
    await expect(
      inOperation('rollback', () =>
        unitOfWork.run(async () => {
          await audit.record('SYSTEM_GLOBAL_CONFIG_VIEWED', { actorId: userId });
          throw new Error('regla de negocio');
        })
      )
    ).rejects.toThrow('regla de negocio');

    expect(await countFor('rollback')).toBe(0);
  });

  it('un intento fallido queda aunque la unidad de trabajo se revierta', async () => {
    await expect(
      inOperation('failed', () =>
        unitOfWork.run(async () => {
          await audit.record('AUTH_FAILURE', { actorId: userId, outcome: 'failure' });
          throw new Error('credenciales inválidas');
        })
      )
    ).rejects.toThrow('credenciales inválidas');

    expect(await countFor('failed')).toBe(1);
  });

  it('una acción con alert crea su alerta enlazada al registro, con el contexto de la operación', async () => {
    await inOperation('alert', () => audit.record('SYSTEM_GLOBAL_CONFIG_UPDATED', { actorId: userId, details: { updatedFields: ['x'] } }));

    const log = await prisma.auditLog.findFirstOrThrow({ where: { correlationId: `${TAG}-alert` } });
    expect(log).toMatchObject({ action: 'SYSTEM_GLOBAL_CONFIG_UPDATED', userId, category: 'Configuración', risk: 'high' });
    const alert = await prisma.auditAlert.findFirst({ where: { auditLogId: log.auditLogId } });
    expect(alert).toMatchObject({ action: 'SYSTEM_GLOBAL_CONFIG_UPDATED', userId });
  });

  it('listado con executor, conteo por sesión y referencias de entidades', async () => {
    await auditLogRepository.create({ ...base, action: `${TAG}-a`, userId, sessionId: SESSION_A, entityTable: 'user_consents', entityId: randomUUID() });
    await auditLogRepository.create({ ...base, action: `${TAG}-a`, userId, sessionId: SESSION_A });
    await auditLogRepository.create({ ...base, action: `${TAG}-b`, sessionId: SESSION_B });

    const { rows, count } = await auditLogRepository.searchPaginated({ module: TAG, sessionId: SESSION_A }, page());
    expect(count).toBe(2);
    expect(rows[0]?.executor).toEqual({ userId, username: TAG, person: { firstName: 'Ana', lastName: TAG } });

    const counts = await auditLogRepository.countBySessionIds([SESSION_A, SESSION_B, randomUUID()]);
    expect(Object.fromEntries(counts.map(c => [c.sessionId, c.count]))).toEqual({ [SESSION_A]: 2, [SESSION_B]: 1 });

    const refs = await auditLogRepository.findEntityRefsBySession(SESSION_A);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.entityTable).toBe('user_consents');
  });

  it('append-only: un borrado sin autorización lo rechaza el trigger; la purga autorizada borra', async () => {
    const old = new Date('1980-01-01T00:00:00Z');
    await prisma.auditLog.create({ data: { ...base, action: `${TAG}-old`, createdAt: old, updatedAt: old } });

    await expect(prisma.auditLog.deleteMany({ where: { action: `${TAG}-old` } })).rejects.toThrow();
    expect(await auditLogRepository.countCreatedBefore(new Date('1990-01-01'))).toBeGreaterThanOrEqual(1);

    await expect(auditLogRepository.purgeCreatedBefore(new Date('1990-01-01'))).resolves.toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { action: `${TAG}-old` } })).toBe(0);
  });

  it('alertas: reconocer solo cambia las pendientes y adjunta quién reconoció', async () => {
    const alert = await auditAlertRepository.create({ action: TAG, risk: 'high', userId });
    expect(await auditAlertRepository.acknowledge(alert.auditAlertId, userId)).toBe(1);
    expect(await auditAlertRepository.acknowledge(alert.auditAlertId, userId)).toBe(0);
    expect(await auditAlertRepository.findById(alert.auditAlertId)).toMatchObject({ acknowledged: true, actor: { userId }, acknowledgedByUser: { username: TAG } });
  });

  it('intentos de login: el documento se guarda cifrado y el bloqueo se busca por su hash', async () => {
    const nationalId = `${Date.now()}`;
    await userLoginAttemptRepository.recordAttempt({ userId, usernameAttempt: TAG, nationalId, success: false, blockedUntil: new Date(Date.now() + 10 * 60 * 1000) });

    const stored = await prisma.userLoginAttempt.findFirst({ where: { usernameAttempt: TAG } });
    expect(stored?.nationalId).not.toBe(nationalId);
    expect(await userLoginAttemptRepository.checkIfBlocked(nationalId)).toMatchObject({ blocked: true });
    expect(await userLoginAttemptRepository.checkIfBlocked(`${nationalId}9`)).toBeNull();
  });
});
