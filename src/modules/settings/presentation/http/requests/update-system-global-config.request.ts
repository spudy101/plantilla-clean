// Entrada de la configuración global: actualización parcial (cada campo es opcional).
import { z, withHint } from '../../../../../shared/presentation/validation/z';
import { input, optionalBool } from '../../../../../shared/presentation/validation/fields';

const MIN_RETENTION_YEARS = 1;
// Resiliencia homologada de integraciones (RF-INT-01 CA-6). Rangos amplios pero acotados por seguridad.
const MIN_TIMEOUT_MS = 1000; // 1s
const MAX_TIMEOUT_MS = 120000; // 2 min
const MIN_MAX_RETRIES = 0;
const MAX_MAX_RETRIES = 10;
const MIN_CB_FAILURE_THRESHOLD = 1;
const MAX_CB_FAILURE_THRESHOLD = 100;
const MIN_CB_RECOVERY_MS = 1000; // 1s
const MAX_CB_RECOVERY_MS = 600000; // 10 min
const MIN_CB_TTL_S = 10;
const MAX_CB_TTL_S = 3600; // 1h

/** Entero en [min, max] (acepta el número como texto). */
const intBetween = (field: string, min: number, max: number, hint: string) => {
  const error = `${field} debe ser un entero entre ${min} y ${max}`;
  return withHint(z.coerce.number({ error }).int({ error }).min(min, { error }).max(max, { error }).optional(), { hint });
};

const atLeastYears = (field: string) => {
  const error = `${field} debe ser un entero mayor o igual a ${MIN_RETENTION_YEARS}`;
  return withHint(z.coerce.number({ error }).int({ error }).min(MIN_RETENTION_YEARS, { error }).optional(), {
    hint: `Ingresá un entero mayor o igual a ${MIN_RETENTION_YEARS}`
  });
};

// Bloque JSONB de merge parcial: lo que no se envía conserva su valor actual.
const IntegrationResilience = withHint(
  z.looseObject(
    {
      timeoutMs: intBetween('integrationResilience.timeoutMs', MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, `Ingresá el timeout en ms, entre ${MIN_TIMEOUT_MS} y ${MAX_TIMEOUT_MS}`),
      maxRetries: intBetween('integrationResilience.maxRetries', MIN_MAX_RETRIES, MAX_MAX_RETRIES, `Ingresá el número de reintentos, entre ${MIN_MAX_RETRIES} y ${MAX_MAX_RETRIES}`),
      circuitBreaker: withHint(
        z.looseObject(
          {
            failureThreshold: intBetween(
              'circuitBreaker.failureThreshold',
              MIN_CB_FAILURE_THRESHOLD,
              MAX_CB_FAILURE_THRESHOLD,
              `Ingresá el número de fallos para abrir el breaker, entre ${MIN_CB_FAILURE_THRESHOLD} y ${MAX_CB_FAILURE_THRESHOLD}`
            ),
            recoveryTimeMs: intBetween(
              'circuitBreaker.recoveryTimeMs',
              MIN_CB_RECOVERY_MS,
              MAX_CB_RECOVERY_MS,
              `Ingresá el tiempo de recuperación en ms, entre ${MIN_CB_RECOVERY_MS} y ${MAX_CB_RECOVERY_MS}`
            ),
            failuresTtlS: intBetween('circuitBreaker.failuresTtlS', MIN_CB_TTL_S, MAX_CB_TTL_S, `Ingresá el TTL de la ventana de fallos en segundos, entre ${MIN_CB_TTL_S} y ${MAX_CB_TTL_S}`)
          },
          { error: 'integrationResilience.circuitBreaker debe ser un objeto' }
        ).optional(),
        { hint: 'Enviá un objeto JSON válido' }
      )
    },
    { error: 'integrationResilience debe ser un objeto' }
  ).optional(),
  { hint: 'Enviá un objeto JSON válido' }
);

export const UpdateSystemGlobalConfigBody = input({
  currency: withHint(z.string().trim().min(1, { error: 'currency debe ser un código ISO 4217 de máximo 10 caracteres' }).max(10, { error: 'currency debe ser un código ISO 4217 de máximo 10 caracteres' }).optional(), {
    hint: 'Usá un código ISO 4217 de 1 a 10 caracteres, por ejemplo COP'
  }),
  auditRetentionHotYears: atLeastYears('auditRetentionHotYears'),
  auditRetentionColdYears: atLeastYears('auditRetentionColdYears'),
  auditHotPurgeEnabled: optionalBool('auditHotPurgeEnabled'),
  integrationResilience: IntegrationResilience
});
export type UpdateSystemGlobalConfigBody = z.infer<typeof UpdateSystemGlobalConfigBody>;
