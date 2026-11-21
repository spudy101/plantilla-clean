// Idempotencia contra Postgres real (docs/idempotency.md). La garantía descansa en la base: el reclamo
// de la clave es un INSERT contra la PK (scope, clave), así que dos peticiones simultáneas no pueden
// ejecutar las dos. Un mock no prueba eso.

import { randomUUID } from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import prisma from '../../src/shared/infrastructure/database/prisma';
import AppError from '../../src/shared/presentation/http/app-error.util';
import ApiResponse from '../../src/shared/presentation/http/app-response.util';
import ErrorMiddleware from '../../src/shared/presentation/http/error.middleware';
import { idempotent } from '../../src/shared/presentation/http/idempotency/idempotency.middleware';
import idempotencyRepository from '../../src/shared/infrastructure/database/idempotency.repository';

const USER = randomUUID();
const OTHER_USER = randomUUID();
const scopeOf = (userId: string) => `user:${userId}`;

/**
 * App de prueba: una operación con efectos que cuenta cuántas veces se ejecutó de verdad. `behavior`
 * decide qué hace cada ejecución (responder, fallar, esperar).
 */
function buildApp() {
  const executions: unknown[] = [];
  let behavior: (req: Request, res: Response) => Promise<unknown> = async (req, res) =>
    ApiResponse.created(res, 'Creado', { n: executions.length, body: req.body });
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { userId: req.header('x-test-user') ?? USER } as never;
    next();
  });
  app.post(
    '/ops',
    idempotent(),
    ErrorMiddleware.asyncHandler(async (req, res) => {
      executions.push(req.body);
      return behavior(req, res);
    })
  );
  app.use(ErrorMiddleware.handleError);
  return {
    app,
    executions,
    setBehavior: (fn: typeof behavior) => {
      behavior = fn;
    }
  };
}

const post = (app: express.Express, key: string | null, body: object, user = USER) => {
  const r = request(app).post('/ops').set('x-test-user', user).send(body);
  return key ? r.set('Idempotency-Key', key) : r;
};

describe('Idempotencia · Postgres real', () => {
  afterAll(async () => {
    await prisma.idempotencyKey.deleteMany({ where: { scope: { in: [scopeOf(USER), scopeOf(OTHER_USER)] } } });
  });

  it('sin clave → 400 IDEMPOTENCY_KEY_REQUIRED (permanente) y no ejecuta', async () => {
    const { app, executions } = buildApp();
    const res = await post(app, null, { a: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REQUIRED', retryable: false });
    expect(executions).toHaveLength(0);
  });

  it('clave con formato inválido → 400 IDEMPOTENCY_KEY_INVALID', async () => {
    const { app } = buildApp();
    const res = await post(app, 'con espacios', { a: 1 });
    expect(res.body.errorCode).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('el reintento con la misma clave recibe la misma respuesta sin ejecutar de nuevo', async () => {
    const { app, executions } = buildApp();
    const key = randomUUID();

    const first = await post(app, key, { a: 1 });
    const retry = await post(app, key, { a: 1 });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body); // idéntica, timestamp incluido
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(executions).toHaveLength(1);
  });

  it('el mismo body con los campos en otro orden es la misma petición', async () => {
    const { app, executions } = buildApp();
    const key = randomUUID();
    await post(app, key, { a: 1, b: { c: 2, d: 3 } });
    const retry = await post(app, key, { b: { d: 3, c: 2 }, a: 1 });
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(executions).toHaveLength(1);
  });

  it('la misma clave con otro body → 422 IDEMPOTENCY_KEY_REUSED (error del cliente)', async () => {
    const { app, executions } = buildApp();
    const key = randomUUID();
    await post(app, key, { a: 1 });
    const res = await post(app, key, { a: 2 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED', retryable: false });
    expect(executions).toHaveLength(1);
  });

  it('las claves son de cada cliente: la misma clave de otro usuario es otra operación', async () => {
    const { app, executions } = buildApp();
    const key = randomUUID();
    await post(app, key, { a: 1 }, USER);
    const other = await post(app, key, { a: 1 }, OTHER_USER);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(executions).toHaveLength(2);
  });

  it('peticiones simultáneas con la misma clave: ejecuta una sola, la otra recibe 409 temporal', async () => {
    const { app, executions, setBehavior } = buildApp();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    setBehavior(async (_req, res) => {
      await gate;
      return ApiResponse.created(res, 'Creado', { n: 1 });
    });
    const key = randomUUID();

    const first = post(app, key, { a: 1 }).then(r => r);
    await new Promise(resolve => {
      setTimeout(resolve, 100);
    });
    const concurrent = await post(app, key, { a: 1 });
    release();
    const firstRes = await first;
    const later = await post(app, key, { a: 1 });

    expect(concurrent.status).toBe(409);
    expect(concurrent.body).toMatchObject({ errorCode: 'REQUEST_IN_PROGRESS', retryable: true });
    expect(concurrent.headers['retry-after']).toBe('2');
    expect(firstRes.status).toBe(201);
    expect(later.headers['idempotent-replayed']).toBe('true');
    expect(executions).toHaveLength(1);
  });

  it('una ráfaga de 10 peticiones iguales a la vez ejecuta exactamente una', async () => {
    const { app, executions, setBehavior } = buildApp();
    setBehavior(async (_req, res) => {
      await new Promise(resolve => {
        setTimeout(resolve, 200);
      });
      return ApiResponse.created(res, 'Creado', { n: 1 });
    });
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 10 }, () => post(app, key, { a: 1 })));

    // Una sola ejecución. Las demás reciben 409 temporal (llegaron mientras corría) o la respuesta
    // guardada (llegaron cuando ya había terminado): según el reparto de tiempos, nunca otra ejecución.
    expect(executions).toHaveLength(1);
    const original = results.filter(r => r.status === 201 && !r.headers['idempotent-replayed']);
    const replayed = results.filter(r => r.status === 201 && r.headers['idempotent-replayed'] === 'true');
    const inProgress = results.filter(r => r.status === 409);
    expect(original).toHaveLength(1);
    expect(replayed.length + inProgress.length).toBe(9);
    expect(replayed.every(r => r.body.data.n === 1)).toBe(true);
  });

  it('un error temporal no se guarda: el reintento se ejecuta de verdad', async () => {
    const { app, executions, setBehavior } = buildApp();
    setBehavior(async () => {
      throw AppError.serviceUnavailable('Proveedor caído', null, 5);
    });
    const key = randomUUID();

    const failed = await post(app, key, { a: 1 });
    setBehavior(async (_req, res) => ApiResponse.created(res, 'Creado', { n: 2 }));
    const retry = await post(app, key, { a: 1 });

    expect(failed.status).toBe(503);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(executions).toHaveLength(2);
  });

  it('un error permanente sí se guarda: el reintento recibe el mismo error sin ejecutar', async () => {
    const { app, executions, setBehavior } = buildApp();
    setBehavior(async () => {
      throw AppError.notFound('Usuario no encontrado');
    });
    const key = randomUUID();

    await post(app, key, { a: 1 });
    const retry = await post(app, key, { a: 1 });

    expect(retry.status).toBe(404);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(executions).toHaveLength(1);
  });

  it('recuperación: si la dueña no terminó y su plazo venció, la clave se retoma y se ejecuta', async () => {
    const { app, executions } = buildApp();
    const key = randomUUID();
    const { createHash } = await import('node:crypto');
    // La fila que dejaría un proceso caído a mitad de la operación (misma petición, plazo vencido)
    const hash = createHash('sha256')
      .update(`POST /ops\n${JSON.stringify({ a: 1 }).replace(/\s/g, '')}`)
      .digest('hex');
    await prisma.idempotencyKey.create({
      data: {
        scope: scopeOf(USER),
        key,
        requestHash: hash,
        lockedUntil: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    const res = await post(app, key, { a: 1 });

    expect(res.status).toBe(201);
    expect(executions).toHaveLength(1);
    expect((await idempotencyRepository.find(scopeOf(USER), key))?.status).toBe('completed');
  });

  it('una clave vencida (más vieja que el TTL) se trata como nueva', async () => {
    const { app, executions } = buildApp();
    const key = randomUUID();
    await post(app, key, { a: 1 });
    await prisma.idempotencyKey.update({
      where: { scope_key: { scope: scopeOf(USER), key } },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const res = await post(app, key, { a: 1 });

    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(executions).toHaveLength(2);
  });

  it('la purga borra solo las claves vencidas', async () => {
    const key = randomUUID();
    await prisma.idempotencyKey.create({
      data: { scope: scopeOf(USER), key, requestHash: 'x'.repeat(64), expiresAt: new Date(Date.now() - 1000) }
    });
    const live = randomUUID();
    await prisma.idempotencyKey.create({
      data: { scope: scopeOf(USER), key: live, requestHash: 'x'.repeat(64), expiresAt: new Date(Date.now() + 60_000) }
    });

    expect(await idempotencyRepository.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(await idempotencyRepository.find(scopeOf(USER), key)).toBeNull();
    expect(await idempotencyRepository.find(scopeOf(USER), live)).not.toBeNull();
  });
});
