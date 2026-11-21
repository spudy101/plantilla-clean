// Reglas de la entidad, sin base de datos ni mocks: es TypeScript puro.
import { SystemGlobalConfig } from './system-global-config';
import { IntegrationResilience } from './integration-resilience';

const config = (
  resilience = IntegrationResilience.of({ timeoutMs: 1000, circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 } })
) =>
  SystemGlobalConfig.restore({
    id: 'cfg-1',
    version: 3,
    currency: 'CLP',
    auditRetention: { hotYears: 5, coldYears: 10, hotPurgeEnabled: false },
    integrationResilience: resilience
  });

describe('SystemGlobalConfig.changesFor', () => {
  it('solo incluye los campos enviados', () => {
    expect(config().changesFor({ currency: 'USD', auditHotPurgeEnabled: true })).toEqual({
      currency: 'USD',
      auditHotPurgeEnabled: true
    });
  });

  it('un patch vacío no cambia nada', () => {
    expect(config().changesFor({})).toEqual({});
  });

  it('fusiona la resiliencia con la actual: lo no enviado se conserva, también dentro del circuit breaker', () => {
    const changes = config().changesFor({ integrationResilience: { maxRetries: 4, circuitBreaker: { failureThreshold: 9 } } });

    expect(changes.integrationResilience?.toProps()).toEqual({
      timeoutMs: 1000,
      maxRetries: 4,
      circuitBreaker: { failureThreshold: 9, recoveryTimeMs: 30000 }
    });
  });

  it('no modifica la entidad (la resiliencia es inmutable)', () => {
    const current = config();
    current.changesFor({ integrationResilience: { timeoutMs: 5000 } });
    expect(current.integrationResilience.timeoutMs).toBe(1000);
  });
});

describe('IntegrationResilience', () => {
  it('isEmpty solo si nunca se configuró nada', () => {
    expect(IntegrationResilience.of().isEmpty()).toBe(true);
    expect(IntegrationResilience.of({ maxRetries: 0 }).isEmpty()).toBe(false);
  });

  it('merge sobre una resiliencia vacía crea el circuit breaker con lo enviado', () => {
    expect(
      IntegrationResilience.of()
        .merge({ circuitBreaker: { failuresTtlS: 60 } })
        .toProps()
    ).toEqual({ circuitBreaker: { failuresTtlS: 60 } });
  });
});
