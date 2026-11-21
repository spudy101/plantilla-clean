// Salida de la configuración global. El esquema describe (y documenta) la respuesta; la función la arma
// campo a campo. El JSONB integration_resilience se guarda en snake_case y sale en camelCase.
import { z } from '../../../shared/validation/z';

/** JSONB system_global_config.integration_resilience (snake_case). */
interface StoredResilience {
  timeout_ms?: number;
  max_retries?: number;
  circuit_breaker?: { failure_threshold?: number; recovery_time_ms?: number; failures_ttl_s?: number };
}

/** Fila de Prisma. El contenido de integrationResilience sigue en snake_case. */
interface SystemGlobalConfigRow {
  systemGlobalConfigId: string;
  configVersion: number | string;
  currency: string;
  auditRetentionHotYears: number;
  auditRetentionColdYears: number;
  auditHotPurgeEnabled?: boolean | null;
  integrationResilience?: unknown;
}

const int = (description: string, example: number) => z.number().int().nullable().meta({ description, example });

export const IntegrationResilience = z
  .object({
    timeoutMs: int('Timeout de cada intento de una llamada a un proveedor externo (ms). Rango: 1000-120000.', 30000),
    maxRetries: int('Intentos por llamada a un proveedor externo (solo ante errores transitorios). Rango: 0-10.', 3),
    circuitBreaker: z.object({
      failureThreshold: int('Fallos para abrir el breaker. Rango: 1-100.', 5),
      recoveryTimeMs: int('Tiempo antes de intentar recuperar tras abrir (ms). Rango: 1000-600000.', 60000),
      failuresTtlS: int('TTL de la ventana de conteo de fallos (s). Rango: 10-3600.', 300)
    })
  })
  .partial()
  .meta({
    description:
      'Resiliencia homologada de TODAS las integraciones salientes (un solo valor, sin overrides por proveedor). ' +
      'Vacío ({}) si nunca se configuró.'
  });
export type IntegrationResilience = z.infer<typeof IntegrationResilience>;

export const SystemGlobalConfig = z
  .object({
    configId: z.uuid(),
    configVersion: z.union([z.number(), z.string()]).meta({ description: 'Versión del registro. Se auto-incrementa en cada PATCH.', example: 3 }),
    currency: z.string().meta({ description: 'Código de moneda (ISO 4217).', example: 'CLP' }),
    auditRetentionHotYears: z.number().int().meta({ description: 'Años de retención en BD (caliente). Afecta directamente el worker de purga.', example: 5 }),
    auditRetentionColdYears: z.number().int().meta({
      description: 'Años de retención en S3 Glacier (frío). Informacional: el lifecycle de S3 es declarativo en la infraestructura.',
      example: 10
    }),
    auditHotPurgeEnabled: z.boolean().meta({
      description:
        'Interruptor de la purga del caliente: con true el worker audit-archive borra de la BD los audit_logs vencidos (la copia queda en S3). Default false.'
    }),
    integrationResilience: IntegrationResilience
  })
  .meta({ description: 'Configuración global del sistema: registro único activo. configVersion se incrementa en cada actualización.' });
export type SystemGlobalConfig = z.infer<typeof SystemGlobalConfig>;

function buildIntegrationResilience(raw: unknown): IntegrationResilience {
  const resilience = raw as StoredResilience | null | undefined;
  if (!resilience || Object.keys(resilience).length === 0) {
    return {};
  }
  const cb = resilience.circuit_breaker ?? {};
  return {
    timeoutMs: resilience.timeout_ms ?? null,
    maxRetries: resilience.max_retries ?? null,
    circuitBreaker: {
      failureThreshold: cb.failure_threshold ?? null,
      recoveryTimeMs: cb.recovery_time_ms ?? null,
      failuresTtlS: cb.failures_ttl_s ?? null
    }
  };
}

function SystemGlobalConfigDTO(record: SystemGlobalConfigRow | null | undefined): SystemGlobalConfig | null {
  if (!record) {
    return null;
  }
  return {
    configId: record.systemGlobalConfigId,
    configVersion: record.configVersion,
    currency: record.currency,
    auditRetentionHotYears: record.auditRetentionHotYears,
    auditRetentionColdYears: record.auditRetentionColdYears,
    auditHotPurgeEnabled: record.auditHotPurgeEnabled ?? false,
    integrationResilience: buildIntegrationResilience(record.integrationResilience)
  };
}

export default { SystemGlobalConfigDTO };
