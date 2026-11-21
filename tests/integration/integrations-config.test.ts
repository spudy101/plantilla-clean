// tests/integration/integrations-config.test.ts
//
// Grupo 4 de la fase 5 (docs/prisma-migration.md) contra Postgres real: configuración global, ventanas de
// fallback y doble aprobación sobre Prisma. Cubre lo que un mock no prueba: el
// include doble de usuarios (requester/secondApprover, que en Sequelize daba
// SQL inválido), la UNIQUE parcial de pendientes y su traducción a 409 en el middleware de errores.

import { randomUUID } from 'node:crypto';
import prisma from '../../src/shared/database/prisma';
import ErrorMiddleware from '../../src/shared/http/error.middleware';
import systemGlobalConfigRepository from '../../src/modules/settings/repositories/system-global-config.repository';
import approvalRequestRepository from '../../src/modules/approvals/repositories/approval-request.repository';
import providerFallbackEventRepository from '../../src/modules/integration/repositories/provider-fallback-event.repository';
import { page } from '../helpers/page';

const TAG = `g4-it-${randomUUID().slice(0, 8)}`;
let roleId: string;
const userIds: string[] = [];
const personIds: string[] = [];

async function newUser(suffix: string): Promise<string> {
  const person = await prisma.person.create({ data: { firstName: `Ana-${suffix}`, lastName: TAG } });
  personIds.push(person.personId);
  const user = await prisma.user.create({ data: { username: `${TAG}-${suffix}`, personId: person.personId, roleId } });
  userIds.push(user.userId);
  return user.userId;
}

describe('Integraciones y config · Prisma contra Postgres', () => {
  beforeAll(async () => {
    roleId = (await prisma.role.create({ data: { name: TAG } })).roleId;
  });

  afterAll(async () => {
    await prisma.approvalRequest.deleteMany({ where: { operationKey: TAG } });
    await prisma.providerFallbackEvent.deleteMany({ where: { provider: TAG } });
    await prisma.user.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.person.deleteMany({ where: { personId: { in: personIds } } });
    await prisma.role.deleteMany({ where: { roleId } });
    await prisma.$disconnect();
  });

  it('configuración global: la versión se incrementa en la base y los JSON se guardan tal cual', async () => {
    const existing = await systemGlobalConfigRepository.findActive();
    const config = existing ?? (await systemGlobalConfigRepository.createActive());
    try {
      const updated = await systemGlobalConfigRepository.update(config.systemGlobalConfigId, {
        configVersion: { increment: 1 },
        integrationResilience: { timeout_ms: 1234, circuit_breaker: { failure_threshold: 9 } }
      });
      expect(updated?.configVersion).toBe(config.configVersion + 1);
      expect((await systemGlobalConfigRepository.findActiveResilience())?.integrationResilience).toEqual({
        timeout_ms: 1234,
        circuit_breaker: { failure_threshold: 9 }
      });
    } finally {
      await prisma.systemGlobalConfig.update({
        where: { systemGlobalConfigId: config.systemGlobalConfigId },
        data: { configVersion: config.configVersion, integrationResilience: config.integrationResilience as object }
      });
      if (!existing) {
        await prisma.systemGlobalConfig.delete({ where: { systemGlobalConfigId: config.systemGlobalConfigId } });
      }
    }
  });

  it('doble aprobación: requester y secondApprover en una consulta, cierre y vencimiento', async () => {
    const maker = await newUser('maker');
    const checker = await newUser('checker');
    const pending = await approvalRequestRepository.create({
      operationKey: TAG,
      entityType: 'User',
      entityId: maker,
      payload: { x: 1 },
      requestedBy: maker,
      requestedAt: new Date(),
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000)
    });

    const { rows, count } = await approvalRequestRepository.findAllPaginatedWithUsers({ operationKey: TAG }, page(), TAG.toUpperCase());
    expect(count).toBe(1);
    expect(rows[0]?.requester).toEqual({ userId: maker, username: `${TAG}-maker`, person: { firstName: 'Ana-maker', lastName: TAG } });

    expect((await approvalRequestRepository.findPendingByEntityIds('User', [maker])).map(r => r.approvalRequestId)).toEqual([pending.approvalRequestId]);
    expect((await approvalRequestRepository.findExpired(new Date())).map(r => r.approvalRequestId)).toContain(pending.approvalRequestId);

    const resolved = await approvalRequestRepository.resolve(pending.approvalRequestId, {
      status: 'approved',
      secondApproverId: checker,
      resolvedAt: new Date(),
      resolutionNotes: 'ok',
      result: { done: true }
    });
    expect(resolved).toMatchObject({ status: 'approved', result: { done: true }, secondApprover: { userId: checker, person: { firstName: 'Ana-checker' } } });
    // Ya no está pendiente: el worker de vencimiento no la pisa
    expect(await approvalRequestRepository.markExpired(pending.approvalRequestId, new Date())).toBe(false);
  });

  it('dos pendientes para la misma operación y entidad: la UNIQUE parcial responde 409 vía el middleware', async () => {
    const maker = await newUser('dup');
    const data = { operationKey: TAG, entityType: 'User', entityId: maker, payload: {}, requestedBy: maker, requestedAt: new Date(), status: 'pending' as const };
    await approvalRequestRepository.create(data);

    const error = await approvalRequestRepository.create(data).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'PrismaClientKnownRequestError', code: 'P2002' });

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn() };
    ErrorMiddleware._handleKnownErrors(error as never, res as never, { correlationId: 'c' } as never);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('fallback: abrir y cerrar la ventana del proveedor', async () => {
    const startedAt = new Date();
    await providerFallbackEventRepository.openFallback({ provider: TAG, circuitProduct: 'aws_sms', startedAt, metadata: { reason: 'it' } });
    expect(await prisma.providerFallbackEvent.count({ where: { provider: TAG, endedAt: null } })).toBe(1);

    const closed = await providerFallbackEventRepository.closeFallback({ provider: TAG, startedAt, endedAt: new Date(), affectedCount: 2 });
    expect(closed).toMatchObject({ provider: TAG, affectedProcessesCount: 2 });
    expect(await providerFallbackEventRepository.closeFallback({ provider: TAG, endedAt: new Date(), affectedCount: 0 })).toBeNull();
  });
});
