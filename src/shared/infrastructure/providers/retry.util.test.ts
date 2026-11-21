// tests/unit/shared/retry.util.test.ts
//
// withRetry: ejecuta una fn async con reintentos y backoff exponencial (baseDelayMs * 2^(intento-1)).
// Solo reintenta si la fn LANZA; un valor resuelto (aunque sea un error de negocio) se retorna tal cual.
// Usamos fake timers para no esperar los delays reales, avanzándolos con las variantes *Async
// para que se intercalen con los microtasks del bucle async.

jest.mock('../observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { mocked, Loose } from 'tests/helpers/mock';
import loggerUtilModule from '../observability/logger.util';
const { logger } = mocked(loggerUtilModule);
import retryUtilModule from './retry.util';
const { withRetry } = retryUtilModule;

describe('withRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retorna el resultado al primer intento exitoso sin reintentar ni esperar', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reintenta tras un fallo y retorna el éxito del segundo intento', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 1000, label: 'retry' });
    // Avanzamos el primer delay (1000ms) para que arranque el segundo intento.
    await jest.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propaga el error del último intento cuando todos fallan', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('siempre falla'));
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 1000, label: 'fail' });
    const captured = p.catch((e: unknown) => e);
    // delays: 1000ms (tras intento 1) + 2000ms (tras intento 2); el intento 3 no espera.
    await jest.runAllTimersAsync();
    const err = (await captured) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('siempre falla');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respeta maxRetries: con 1 no reintenta', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('x'));
    const p = withRetry(fn, { maxRetries: 1, baseDelayMs: 1000 });
    const captured = p.catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    await captured;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('NO reintenta si la fn resuelve un valor (aunque sea un error de negocio)', async () => {
    const businessError = { ok: false, error: 'saldo insuficiente' };
    const fn = jest.fn().mockResolvedValue(businessError);
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1000 });
    expect(result).toBe(businessError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('aplica backoff exponencial: 1000ms tras el 1er fallo, 2000ms tras el 2do', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 1000, label: 'backoff' });
    const captured = p.catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    await captured;

    // Los dos avisos de reintento reflejan la fórmula de backoff en el mensaje.
    const retryMessages = logger.warn.mock.calls.map((c: Loose) => c[0]);
    expect(retryMessages.some((m: Loose) => m.includes('intento 1/3') && m.includes('1000ms'))).toBe(true);
    expect(retryMessages.some((m: Loose) => m.includes('intento 2/3') && m.includes('2000ms'))).toBe(true);
    // Y un aviso final de que todos los intentos fallaron.
    expect(retryMessages.some((m: Loose) => m.includes('todos los 3 intentos fallaron'))).toBe(true);
  });

  it('usa maxRetries=3 por defecto cuando no se pasa opción', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('def'));
    const p = withRetry(fn);
    const captured = p.catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    await captured;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
