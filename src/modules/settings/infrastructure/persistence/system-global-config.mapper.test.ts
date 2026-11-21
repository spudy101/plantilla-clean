// El mapper es la frontera con la base: la entidad usa camelCase, el JSONB se guarda en snake_case.
import { SystemGlobalConfigMapper } from './system-global-config.mapper';
import { IntegrationResilience } from '../../domain/integration-resilience';

const row = {
  systemGlobalConfigId: 'cfg-1',
  configVersion: 3,
  currency: 'CLP',
  auditRetentionHotYears: 5,
  auditRetentionColdYears: 10,
  auditHotPurgeEnabled: true,
  integrationResilience: { timeout_ms: 1000, circuit_breaker: { failure_threshold: 5 } }
};

describe('SystemGlobalConfigMapper', () => {
  it('fila → entidad (snake_case → camelCase, sin inventar campos que no están guardados)', () => {
    const config = SystemGlobalConfigMapper.toDomain(row);

    expect(config.id).toBe('cfg-1');
    expect(config.auditRetention).toEqual({ hotYears: 5, coldYears: 10, hotPurgeEnabled: true });
    expect(config.integrationResilience.toProps()).toEqual({ timeoutMs: 1000, circuitBreaker: { failureThreshold: 5 } });
  });

  it('JSONB vacío o nulo → resiliencia vacía', () => {
    expect(SystemGlobalConfigMapper.toDomain({ ...row, integrationResilience: null }).integrationResilience.isEmpty()).toBe(true);
  });

  it('cambios → data de Prisma: versión atómica y resiliencia en snake_case', () => {
    const data = SystemGlobalConfigMapper.toUpdate({
      currency: 'USD',
      integrationResilience: IntegrationResilience.of({ maxRetries: 4, circuitBreaker: { recoveryTimeMs: 60000 } })
    });

    expect(data).toEqual({
      configVersion: { increment: 1 },
      currency: 'USD',
      integrationResilience: { max_retries: 4, circuit_breaker: { recovery_time_ms: 60000 } }
    });
  });
});
