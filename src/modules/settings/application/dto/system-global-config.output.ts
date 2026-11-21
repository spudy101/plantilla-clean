// Lo que devuelven los casos de uso de settings (output DTO). Son datos planos: la presentación los
// serializa sin conocer la entidad, y la entidad puede cambiar por dentro sin romper la API.
import type { SystemGlobalConfig } from '../../domain/system-global-config';
import type { IntegrationResilience } from '../../domain/integration-resilience';

export interface IntegrationResilienceOutput {
  timeoutMs?: number | null;
  maxRetries?: number | null;
  circuitBreaker?: { failureThreshold: number | null; recoveryTimeMs: number | null; failuresTtlS: number | null };
}

export interface SystemGlobalConfigOutput {
  configId: string;
  configVersion: number;
  currency: string;
  auditRetentionHotYears: number;
  auditRetentionColdYears: number;
  auditHotPurgeEnabled: boolean;
  /** `{}` si nunca se configuró. */
  integrationResilience: IntegrationResilienceOutput;
}

function resilienceOutput(resilience: IntegrationResilience): IntegrationResilienceOutput {
  if (resilience.isEmpty()) {
    return {};
  }
  const cb = resilience.circuitBreaker ?? {};
  return {
    timeoutMs: resilience.timeoutMs ?? null,
    maxRetries: resilience.maxRetries ?? null,
    circuitBreaker: {
      failureThreshold: cb.failureThreshold ?? null,
      recoveryTimeMs: cb.recoveryTimeMs ?? null,
      failuresTtlS: cb.failuresTtlS ?? null
    }
  };
}

export function toSystemGlobalConfigOutput(config: SystemGlobalConfig): SystemGlobalConfigOutput {
  return {
    configId: config.id,
    configVersion: config.version,
    currency: config.currency,
    auditRetentionHotYears: config.auditRetention.hotYears,
    auditRetentionColdYears: config.auditRetention.coldYears,
    auditHotPurgeEnabled: config.auditRetention.hotPurgeEnabled,
    integrationResilience: resilienceOutput(config.integrationResilience)
  };
}
