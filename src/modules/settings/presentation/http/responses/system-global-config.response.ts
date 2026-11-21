// Esquema de la respuesta HTTP de la configuración global: describe (y documenta en Swagger) la salida
// de los casos de uso (application/dto/system-global-config.output.ts). La prueba de conformidad
// (system-global-config.response.test.ts) exige que esa salida cumpla este esquema.
import { z } from '../../../../../shared/presentation/validation/z';

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
    configVersion: z
      .union([z.number(), z.string()])
      .meta({ description: 'Versión del registro. Se auto-incrementa en cada PATCH.', example: 3 }),
    currency: z.string().meta({ description: 'Código de moneda (ISO 4217).', example: 'CLP' }),
    auditRetentionHotYears: z
      .number()
      .int()
      .meta({ description: 'Años de retención en BD (caliente). Afecta directamente el worker de purga.', example: 5 }),
    auditRetentionColdYears: z.number().int().meta({
      description:
        'Años de retención en S3 Glacier (frío). Informacional: el lifecycle de S3 es declarativo en la infraestructura.',
      example: 10
    }),
    auditHotPurgeEnabled: z.boolean().meta({
      description:
        'Interruptor de la purga del caliente: con true el worker audit-archive borra de la BD los audit_logs vencidos (la copia queda en S3). Default false.'
    }),
    integrationResilience: IntegrationResilience
  })
  .meta({
    description: 'Configuración global del sistema: registro único activo. configVersion se incrementa en cada actualización.'
  });
export type SystemGlobalConfig = z.infer<typeof SystemGlobalConfig>;
