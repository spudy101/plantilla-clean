// tests/integration/operations.test.ts
//
// Traza de operaciones contra Postgres real: cada petición HTTP y cada runOperation dejan su fila en
// `operations` (inicio + cierre), el id lo genera el servidor y los fallos de worker quedan en failure
// sin tumbar el proceso.
import request from 'supertest';
import prisma from '../../src/shared/database/prisma';
import app from '../../src/app';
import { runOperation } from '../../src/shared/observability/operation';
import requestContext from '../../src/shared/observability/request-context.util';

const POLL_MS = 50;
const POLL_TRIES = 60;

/** La escritura de la traza es asíncrona (no frena la operación): se espera a que quede cerrada. */
async function waitClosed(operationId: string) {
  for (let i = 0; i < POLL_TRIES; i++) {
    const row = await prisma.operation.findUnique({ where: { operationId } });
    if (row && row.status !== 'running') {
      return row;
    }
    await new Promise(resolve => {
      setTimeout(resolve, POLL_MS);
    });
  }
  throw new Error(`la operación ${operationId} no se cerró`);
}

const created: string[] = [];

describe('Traza de operaciones · Postgres', () => {
  afterAll(async () => {
    await prisma.operation.deleteMany({ where: { OR: [{ operationId: { in: created } }, { parentId: { in: created } }] } });
    await prisma.$disconnect();
  });

  it('una petición HTTP deja su operación con la plantilla de la ruta, estado y duración', async () => {
    const res = await request(app).get('/client/api/v1/kyc/maintainers/genders').set('X-Request-Id', 'cliente-123');
    const id = String(res.headers['x-correlation-id']);
    created.push(id);

    const row = await waitClosed(id);
    expect(row).toMatchObject({
      source: 'http',
      name: 'GET /client/api/v1/kyc/maintainers/genders',
      status: res.status < 400 ? 'success' : 'failure',
      httpStatus: res.status,
      clientRequestId: 'cliente-123'
    });
    expect(row.durationMs).toEqual(expect.any(Number));
    expect(row.endedAt).not.toBeNull();
  });

  it('una ruta inexistente queda en failure con su http status', async () => {
    const res = await request(app).get('/client/api/v1/no-existe');
    const id = String(res.headers['x-correlation-id']);
    created.push(id);

    const row = await waitClosed(id);
    expect(row).toMatchObject({ status: 'failure', httpStatus: 404 });
  });

  it('el health check no deja fila', async () => {
    const res = await request(app).get('/health');
    const id = String(res.headers['x-correlation-id']);
    await new Promise(resolve => {
      setTimeout(resolve, POLL_MS * 4);
    });
    expect(await prisma.operation.findUnique({ where: { operationId: id } })).toBeNull();
  });

  it('runOperation de worker: éxito con su nombre y los hijos enlazados al padre', async () => {
    let parentId = '';
    let childId = '';
    await runOperation({ source: 'worker', name: 'test.parent' }, async () => {
      parentId = requestContext.get()!.correlationId;
      await runOperation({ source: 'system', name: 'test.child' }, () => {
        childId = requestContext.get()!.correlationId;
      });
    });
    created.push(parentId);

    expect(await waitClosed(parentId)).toMatchObject({ source: 'worker', name: 'test.parent', status: 'success' });
    expect(await waitClosed(childId)).toMatchObject({ source: 'system', parentId, status: 'success' });
  });

  it('un worker que falla queda en failure y no relanza', async () => {
    let id = '';
    const result = await runOperation({ source: 'worker', name: 'test.failing' }, () => {
      id = requestContext.get()!.correlationId;
      throw new Error('boom');
    });
    created.push(id);

    expect(result).toBeUndefined();
    expect(await waitClosed(id)).toMatchObject({ status: 'failure', errorCode: 'UNHANDLED_ERROR', errorMessage: 'boom' });
  });

  it('una tarea de sistema que falla relanza el error', async () => {
    let id = '';
    await expect(
      runOperation({ source: 'system', name: 'test.system-failing' }, () => {
        id = requestContext.get()!.correlationId;
        throw new Error('caído');
      })
    ).rejects.toThrow('caído');
    created.push(id);
    expect(await waitClosed(id)).toMatchObject({ status: 'failure' });
  });
});
