// Adaptadores del circuit breaker: el estado del breaker → snapshot del dominio, y el listener que conecta
// onOpen/onClose con los casos de uso (nunca lanza).
jest.mock('../../../../shared/infrastructure/observability/operation', () => ({
  runOperation: (_opts: unknown, fn: () => unknown) => fn()
}));

import { PROVIDER_PRODUCTS } from '../../../../shared/infrastructure/providers/provider-call.util';
import { CircuitBreakerStatusReader } from './circuit-breaker-status.reader';
import { createFallbackCircuitListener } from './fallback-circuit.listener';
import { RecordFallbackOpened } from '../../application/use-cases/record-fallback-opened.use-case';
import { RecordFallbackResolved } from '../../application/use-cases/record-fallback-resolved.use-case';
import { RecordingAuditTrail } from '../../../../../tests/doubles/settings.doubles';
import { InMemoryFallbackEvents, StubFailedProcesses } from '../../../../../tests/doubles/integration.doubles';

const OPENED_AT = Date.parse('2026-11-18T10:00:00Z');

describe('CircuitBreakerStatusReader', () => {
  it('lee el circuito de cada proveedor y lo traduce al dominio', async () => {
    const getStatus = jest.fn(async (product: string) => ({
      product,
      status: product === 's3' ? ('OPEN' as const) : ('CLOSED' as const),
      failures: product === 's3' ? 5 : 0,
      openedAt: product === 's3' ? OPENED_AT : null,
      openedAtISO: null
    }));

    const snapshots = await new CircuitBreakerStatusReader({ getStatus }).readAll();

    expect(getStatus).toHaveBeenCalledTimes(PROVIDER_PRODUCTS.length);
    expect(snapshots.map(s => s.product)).toEqual([...PROVIDER_PRODUCTS]);
    expect(snapshots.find(s => s.product === 's3')).toEqual({ product: 's3', state: 'OPEN', failures: 5, openedAt: new Date(OPENED_AT) });
  });
});

describe('createFallbackCircuitListener', () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const build = (fallbacks: InMemoryFallbackEvents) => {
    const audit = new RecordingAuditTrail();
    return createFallbackCircuitListener(
      {
        recordOpened: new RecordFallbackOpened(fallbacks, audit, logger),
        recordResolved: new RecordFallbackResolved(fallbacks, new StubFailedProcesses(2), audit, logger)
      },
      logger
    );
  };

  beforeEach(() => jest.clearAllMocks());

  it('onOpen y onClose reciben el instante en ms y lo pasan como fecha', async () => {
    const fallbacks = new InMemoryFallbackEvents();
    const listener = build(fallbacks);

    await listener.onOpen('ses', OPENED_AT);
    await listener.onClose('ses', OPENED_AT);

    expect(fallbacks.opened[0]?.startedAt).toEqual(new Date(OPENED_AT));
    expect(fallbacks.closed[0]).toMatchObject({ provider: 'aws_ses', startedAt: new Date(OPENED_AT) });
  });

  it('nunca lanza: un error de BD se loguea', async () => {
    const fallbacks = new InMemoryFallbackEvents();
    fallbacks.failOpen = true;

    await expect(build(fallbacks).onOpen('ses', OPENED_AT)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('[ProviderFallback] Error registrando la apertura', { product: 'ses', error: 'BD caída' });
  });
});
