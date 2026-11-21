// Contrato de errores de la API por HTTP real (Express + ErrorMiddleware + ApiResponse): lo que un
// consumidor necesita para decidir si reintentar. docs/errors-and-retries.md.
//   - `retryable` en todo error; `Retry-After` cuando se sabe cuánto esperar
//   - `errors` = array por campo; `details` = objeto de contexto (p. ej. `code` de un 401)

jest.mock('../../../src/shared/infrastructure/cache/redis.util', () => ({ isAvailable: () => false, getClient: () => null }));
jest.mock('../../../src/shared/infrastructure/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
  sanitizeForLog: (v: unknown) => v
}));
jest.mock('../../../src/shared/infrastructure/observability/audit-hook', () => ({ auditInfraEvent: jest.fn() }));

import express from 'express';
import request from 'supertest';
import AppError from '../../../src/shared/presentation/http/app-error.util';
import ApiResponse from '../../../src/shared/presentation/http/app-response.util';
import ErrorMiddleware from '../../../src/shared/presentation/http/error.middleware';
import RequestLockMiddleware from '../../../src/shared/presentation/http/request-lock.middleware';
import { CircuitOpenError } from '../../../src/shared/infrastructure/providers/circuit-breaker.util';
import { isRetryableStatus } from '../../../src/shared/presentation/http/retryable';

function appThrowing(err: unknown) {
  const app = express();
  app.get('/x', () => {
    throw err;
  });
  app.use(ErrorMiddleware.handleError);
  return app;
}

describe('contrato de errores', () => {
  it('status temporales: 408, 429, 502, 503, 504 (el resto, permanente)', () => {
    expect([408, 429, 502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 422, 500].some(isRetryableStatus)).toBe(false);
  });

  it('401: permanente, el motivo viaja en details.code', async () => {
    const res = await request(appThrowing(AppError.unauthorized('Token vencido', { code: 'TOKEN_EXPIRED' }))).get('/x');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ errorCode: 'UNAUTHORIZED', retryable: false, details: { code: 'TOKEN_EXPIRED' } });
    expect(res.body).not.toHaveProperty('errors');
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('422 de validación: errors es el array por campo', async () => {
    const res = await request(
      appThrowing(AppError.unprocessableEntity('Error de validación', [{ field: 'email', message: 'inválido' }]))
    ).get('/x');
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([expect.objectContaining({ field: 'email' })]);
    expect(res.body.retryable).toBe(false);
  });

  it('429 con espera conocida: retryable + Retry-After', async () => {
    const res = await request(appThrowing(AppError.tooManyRequests('Esperá', null, 42))).get('/x');
    expect(res.status).toBe(429);
    expect(res.body.retryable).toBe(true);
    expect(res.headers['retry-after']).toBe('42');
  });

  it('409 de petición en curso: temporal (a diferencia del 409 de conflicto)', async () => {
    const inProgress = await request(appThrowing(AppError.requestInProgress('En curso', 2))).get('/x');
    expect(inProgress.status).toBe(409);
    expect(inProgress.body).toMatchObject({ errorCode: 'REQUEST_IN_PROGRESS', retryable: true });
    expect(inProgress.headers['retry-after']).toBe('2');

    const conflict = await request(appThrowing(AppError.conflict('Ya existe'))).get('/x');
    expect(conflict.body).toMatchObject({ errorCode: 'CONFLICT', retryable: false });
  });

  it('circuito abierto: 503 temporal con Retry-After hasta la próxima prueba', async () => {
    const res = await request(appThrowing(new CircuitOpenError('ses', 4200))).get('/x');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ errorCode: 'CIRCUIT_OPEN', retryable: true });
    expect(res.headers['retry-after']).toBe('5');
  });

  it('un error inesperado es un 500 permanente', async () => {
    const res = await request(appThrowing(new Error('bug'))).get('/x');
    expect(res.status).toBe(500);
    expect(res.body.retryable).toBe(false);
  });

  it('ApiResponse directo (middlewares) también informa retryable', async () => {
    const app = express();
    app.get('/x', (_req, res) => ApiResponse.tooManyRequests(res, 'Muchas', 30));
    const res = await request(app).get('/x');
    expect(res.status).toBe(429);
    expect(res.body.retryable).toBe(true);
    expect(res.headers['retry-after']).toBe('30');
  });
});

describe('RequestLockMiddleware: la petición gemela recibe 409 temporal con Retry-After', () => {
  it('mientras la primera sigue en curso, la segunda espera lo que dura el lock', async () => {
    const app = express();
    let release!: () => void;
    const firstDone = new Promise<void>(resolve => {
      release = resolve;
    });
    app.post('/p', RequestLockMiddleware.forPublicEndpoints({ ttl: 3 }), async (_req, res) => {
      await firstDone;
      res.json({ ok: true });
    });

    const first = request(app).post('/p').send({ a: 1 });
    const firstPending = first.then(r => r);
    await new Promise(resolve => {
      setTimeout(resolve, 50);
    });
    const second = await request(app).post('/p').send({ a: 1 });
    release();
    await firstPending;

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ errorCode: 'REQUEST_IN_PROGRESS', retryable: true });
    expect(second.headers['retry-after']).toBe('3');
  });
});
