// Traduce entre la fila de Prisma y la entidad del dominio. Es el único lugar que sabe que
// integration_resilience se guarda como JSONB en snake_case (con circuit_breaker anidado).
import type {
  Prisma,
  SystemGlobalConfig as SystemGlobalConfigRow
} from '../../../../shared/infrastructure/database/generated/prisma/client';
import { SystemGlobalConfig, type SystemGlobalConfigChanges } from '../../domain/system-global-config';
import { IntegrationResilience } from '../../domain/integration-resilience';

/** system_global_config.integration_resilience tal como se guarda. */
interface StoredResilience {
  timeout_ms?: number;
  max_retries?: number;
  circuit_breaker?: { failure_threshold?: number; recovery_time_ms?: number; failures_ttl_s?: number };
}

/** Columnas que lee el mapper (las demás de la tabla, como promotional_banners, son de otros módulos). */
export type SystemGlobalConfigRecord = Pick<
  SystemGlobalConfigRow,
  | 'systemGlobalConfigId'
  | 'configVersion'
  | 'currency'
  | 'auditRetentionHotYears'
  | 'auditRetentionColdYears'
  | 'auditHotPurgeEnabled'
  | 'integrationResilience'
>;

export const SYSTEM_GLOBAL_CONFIG_COLUMNS = {
  systemGlobalConfigId: true,
  configVersion: true,
  currency: true,
  auditRetentionHotYears: true,
  auditRetentionColdYears: true,
  auditHotPurgeEnabled: true,
  integrationResilience: true
} as const satisfies Prisma.SystemGlobalConfigSelect;

function resilienceFromStored(raw: unknown): IntegrationResilience {
  const stored = (raw ?? {}) as StoredResilience;
  const cb = stored.circuit_breaker;
  return IntegrationResilience.of({
    ...(stored.timeout_ms !== undefined ? { timeoutMs: stored.timeout_ms } : {}),
    ...(stored.max_retries !== undefined ? { maxRetries: stored.max_retries } : {}),
    ...(cb
      ? {
          circuitBreaker: {
            ...(cb.failure_threshold !== undefined ? { failureThreshold: cb.failure_threshold } : {}),
            ...(cb.recovery_time_ms !== undefined ? { recoveryTimeMs: cb.recovery_time_ms } : {}),
            ...(cb.failures_ttl_s !== undefined ? { failuresTtlS: cb.failures_ttl_s } : {})
          }
        }
      : {})
  });
}

function resilienceToStored(resilience: IntegrationResilience): StoredResilience {
  const { timeoutMs, maxRetries, circuitBreaker } = resilience.toProps();
  return {
    ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
    ...(maxRetries !== undefined ? { max_retries: maxRetries } : {}),
    ...(circuitBreaker
      ? {
          circuit_breaker: {
            ...(circuitBreaker.failureThreshold !== undefined ? { failure_threshold: circuitBreaker.failureThreshold } : {}),
            ...(circuitBreaker.recoveryTimeMs !== undefined ? { recovery_time_ms: circuitBreaker.recoveryTimeMs } : {}),
            ...(circuitBreaker.failuresTtlS !== undefined ? { failures_ttl_s: circuitBreaker.failuresTtlS } : {})
          }
        }
      : {})
  };
}

export const SystemGlobalConfigMapper = {
  toDomain(row: SystemGlobalConfigRecord): SystemGlobalConfig {
    return SystemGlobalConfig.restore({
      id: row.systemGlobalConfigId,
      version: row.configVersion,
      currency: row.currency,
      auditRetention: {
        hotYears: row.auditRetentionHotYears,
        coldYears: row.auditRetentionColdYears,
        hotPurgeEnabled: row.auditHotPurgeEnabled
      },
      integrationResilience: resilienceFromStored(row.integrationResilience)
    });
  },

  /** Los cambios como `data` de Prisma. La versión se incrementa en la base (atómico). */
  toUpdate(changes: SystemGlobalConfigChanges): Prisma.SystemGlobalConfigUpdateManyMutationInput {
    return {
      configVersion: { increment: 1 },
      ...(changes.currency !== undefined ? { currency: changes.currency } : {}),
      ...(changes.auditRetentionHotYears !== undefined ? { auditRetentionHotYears: changes.auditRetentionHotYears } : {}),
      ...(changes.auditRetentionColdYears !== undefined ? { auditRetentionColdYears: changes.auditRetentionColdYears } : {}),
      ...(changes.auditHotPurgeEnabled !== undefined ? { auditHotPurgeEnabled: changes.auditHotPurgeEnabled } : {}),
      ...(changes.integrationResilience !== undefined
        ? { integrationResilience: resilienceToStored(changes.integrationResilience) as Prisma.InputJsonValue }
        : {})
    };
  }
};
