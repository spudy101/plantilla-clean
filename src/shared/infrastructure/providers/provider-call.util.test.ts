// callProvider: breaker + reintentos (solo transitorios) + timeout por intento + una línea de log por
// llamada (con métricas EMF en producción). El breaker es el real en memoria; logger y config, dobles.

jest.mock('../cache/redis.util', () => ({ getClient: jest.fn(() => null), isAvailable: jest.fn(() => false) }));
jest.mock('./resilience-config.util', () => ({
  HARD_DEFAULTS: { circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 } },
  get: jest.fn()
}));
jest.mock('../observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { mocked } from 'tests/helpers/mock';
import ResilienceConfigModule from './resilience-config.util';
const ResilienceConfig = mocked(ResilienceConfigModule);
import loggerUtilModule from '../observability/logger.util';
const { logger } = mocked(loggerUtilModule);
import CircuitBreaker from './circuit-breaker.util';
import txContext from '../database/transaction-context';
import { callProvider, CircuitOpenError } from './provider-call.util';
import { isTransientError, providerFailure } from './provider-errors';
import AppError from '../../presentation/http/app-error.util';

const awsError = (name: string, httpStatusCode: number, extra: object = {}) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode }, ...extra });

describe('isTransientError', () => {
  it.each([
    ['5xx', awsError('InternalFailure', 500), true],
    ['503', awsError('ServiceUnavailable', 503), true],
    ['429', awsError('TooManyRequests', 429), true],
    ['throttling con 400', awsError('ThrottlingException', 400), true],
    ['$retryable', awsError('Algo', 400, { $retryable: {} }), true],
    ['timeout / abort (sin HTTP)', Object.assign(new Error('timeout'), { name: 'TimeoutError' }), true],
    ['red (sin HTTP)', Object.assign(new Error('socket'), { code: 'ECONNRESET' }), true],
    ['400 del cliente', awsError('MessageRejected', 400), false],
    ['403', awsError('AccessDenied', 403), false],
    ['404', awsError('NoSuchKey', 404), false],
    ['$fault client sin status', Object.assign(new Error('x'), { $fault: 'client' }), false]
  ])('%s → %s', (_label, error, expected) => {
    expect(isTransientError(error)).toBe(expected);
  });
});

describe('providerFailure: qué responder cuando falló una llamada a un proveedor', () => {
  it('un AppError (circuito abierto, o un 4xx de negocio) sale tal cual', () => {
    const notFound = AppError.notFound('no está');
    expect(providerFailure(notFound, 'x')).toBe(notFound);
    const open = new CircuitOpenError('s3', 3000);
    expect(providerFailure(open, 'x')).toBe(open);
  });

  it.each([
    ['5xx del proveedor', awsError('InternalError', 500)],
    ['throttling', awsError('ThrottlingException', 400)],
    ['timeout', Object.assign(new Error('t'), { name: 'TimeoutError' })],
    ['red', Object.assign(new Error('r'), { code: 'ECONNRESET' })]
  ])('%s → 503 temporal', (_label, error) => {
    expect(providerFailure(error, 'Error al subir')).toMatchObject({ statusCode: 503, retryable: true, message: 'Error al subir' });
  });

  it.each([
    ['4xx: el proveedor rechazó la petición', awsError('AccessDenied', 403)],
    ['un bug nuestro (no vino del proveedor)', new TypeError('x is undefined')]
  ])('%s → 500 permanente', (_label, error) => {
    expect(providerFailure(error, 'Error al subir')).toMatchObject({ statusCode: 500, retryable: false });
  });
});

describe('callProvider', () => {
  const call = { product: 'ses' as const, endpoint: 'SES:SendEmailCommand', notificationId: 'n-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    CircuitBreaker._resetMemory();
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    ResilienceConfig.get.mockResolvedValue({
      timeoutMs: 5000,
      maxRetries: 3,
      circuitBreaker: { failureThreshold: 2, recoveryTimeMs: 60000, failuresTtlS: 300 }
    } as never);
  });

  afterEach(() => jest.useRealTimers());

  it('éxito: devuelve el resultado y deja una línea de log con producto, resultado y duración', async () => {
    const result = await callProvider(call, () => Promise.resolve({ id: 'm-1' }));
    expect(result).toEqual({ id: 'm-1' });
    expect(logger.info).toHaveBeenCalledWith(
      '[Provider] ses SES:SendEmailCommand → success',
      expect.objectContaining({
        product: 'ses',
        endpoint: 'SES:SendEmailCommand',
        result: 'success',
        notificationId: 'n-1',
        durationMs: expect.any(Number)
      })
    );
    // fuera de producción no hay bloque EMF
    expect(logger.info.mock.calls[0]![1]).not.toHaveProperty('_aws');
  });

  it('pasa a cada intento una señal con el timeout de settings', async () => {
    const signals: AbortSignal[] = [];
    await callProvider(call, signal => {
      signals.push(signal);
      return Promise.resolve('ok');
    });
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]!.aborted).toBe(false);
  });

  it('error transitorio: reintenta hasta maxRetries y cuenta UN fallo para el circuito', async () => {
    const fn = jest.fn(() => Promise.reject(awsError('ServiceUnavailable', 503)));
    const pending = callProvider(call, fn).catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    expect(await pending).toMatchObject({ name: 'ServiceUnavailable' });
    expect(fn).toHaveBeenCalledTimes(3);
    expect((await CircuitBreaker.getStatus('ses')).failures).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[Provider] ses SES:SendEmailCommand → failed',
      expect.objectContaining({ result: 'failed', errorCode: 'ServiceUnavailable' })
    );
  });

  it('error del cliente: no reintenta ni cuenta para el circuito', async () => {
    const fn = jest.fn(() => Promise.reject(awsError('MessageRejected', 400)));
    await expect(callProvider(call, fn)).rejects.toMatchObject({ name: 'MessageRejected' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect((await CircuitBreaker.getStatus('ses')).failures).toBe(0);
  });

  it('circuito abierto: no llama, lanza CircuitOpenError y lo registra como circuit_open', async () => {
    for (let i = 0; i < 2; i++) {
      const pending = callProvider(call, () => Promise.reject(awsError('InternalFailure', 500))).catch(() => null);
      await jest.runAllTimersAsync();
      await pending;
    }
    const fn = jest.fn(() => Promise.resolve('ok'));
    await expect(callProvider(call, fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenLastCalledWith(
      '[Provider] ses SES:SendEmailCommand → circuit_open',
      expect.objectContaining({ result: 'circuit_open', durationMs: null })
    );
  });
});

describe('callProvider dentro de una transacción', () => {
  it('marca la unidad con efectos externos: el Unit of Work ya no la repetirá ante un conflicto', async () => {
    CircuitBreaker._resetMemory();
    ResilienceConfig.get.mockResolvedValue({ timeoutMs: 5000, maxRetries: 1, circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 } } as never);
    const unit = { prisma: jest.fn() } as { prisma: jest.Mock; externalEffects?: boolean };
    await txContext.runInUnit(unit as never, () => callProvider({ product: 'ses', endpoint: 'SES:SendEmailCommand' }, () => Promise.resolve('ok')));
    expect(unit.externalEffects).toBe(true);
  });
});

describe('callProvider en producción: métricas EMF', () => {
  it('la línea de log trae el bloque _aws con Calls/Failures/Rejected/Latency por Product', async () => {
    jest.resetModules();
    jest.doMock('../config', () => ({ __esModule: true, default: { server: { nodeEnv: 'production' } } }));
    const { callProvider: prodCall } = await import('./provider-call.util');
    const { logger: prodLogger } = (await import('../observability/logger.util')).default;
    const prodConfig = (await import('./resilience-config.util')).default as unknown as { get: jest.Mock };
    prodConfig.get.mockResolvedValue({
      timeoutMs: 5000,
      maxRetries: 1,
      circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 }
    });

    await prodCall({ product: 'ses', endpoint: 'SES:SendEmailCommand' }, () => Promise.resolve('ok'));

    const fields = (prodLogger.info as jest.Mock).mock.calls[0]![1];
    expect(fields).toMatchObject({ Product: 'ses', Calls: 1, Failures: 0, Rejected: 0, Latency: expect.any(Number) });
    expect(fields._aws.CloudWatchMetrics[0]).toEqual({
      Namespace: 'ProviderCalls',
      Dimensions: [['Product']],
      Metrics: [
        { Name: 'Calls', Unit: 'Count' },
        { Name: 'Failures', Unit: 'Count' },
        { Name: 'Rejected', Unit: 'Count' },
        { Name: 'Latency', Unit: 'Milliseconds' }
      ]
    });
  });
});
