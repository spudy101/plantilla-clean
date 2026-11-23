// Esquemas de salida del monitoreo de proveedores externos (solo lectura): semáforo del circuit breaker e
// historial de caídas. Describen (y documentan en Swagger) lo que devuelven los casos de uso
// (application/dto/integration-monitoring.output.ts). Las métricas por llamada están en CloudWatch, no acá.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import { AVAILABILITY_STATUSES, CIRCUIT_STATES } from '../../../application/dto/integration-monitoring.output';

const CircuitView = z.object({
  state: z.enum(CIRCUIT_STATES),
  failures: z.number().int().meta({ description: 'Fallos seguidos en la ventana de conteo.' }),
  openedAt: z.string().nullable().meta({ description: 'Desde cuándo está abierto (null si está cerrado).' })
});

export const FallbackEventSchema = z.object({
  fallbackEventId: z.uuid(),
  provider: z.string().meta({ example: 'aws_ses' }),
  circuitProduct: z.string().meta({ example: 'ses' }),
  startedAt: dateTime(),
  endedAt: dateTime().nullable(),
  active: z.boolean(),
  durationSeconds: z.number().int().nullable(),
  affectedProcessesCount: z.number().int().nullable()
});

export const ProvidersHealthSchema = z.object({
  providers: z.array(
    z.object({
      product: z.string().meta({ example: 'ses' }),
      availabilityStatus: z.enum(AVAILABILITY_STATUSES),
      circuit: CircuitView
    })
  ),
  activeFallbacks: z.number().int().meta({ description: 'Caídas abiertas (provider_fallback_events sin fin).' }),
  generatedAt: z.string()
});
