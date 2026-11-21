import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import type { ProviderFallbackEvent } from '../../../shared/database/generated/prisma/client';
import type CircuitBreaker from '../../../shared/infra/circuit-breaker.util';
// Salidas del monitoreo de proveedores externos (solo lectura): semáforo del circuit breaker e
// historial de caídas. Las métricas por llamada están en CloudWatch, no acá.

type CircuitStatus = Awaited<ReturnType<typeof CircuitBreaker.getStatus>>;

const AVAILABILITY = { CLOSED: 'Disponible', HALF_OPEN: 'Degradado', OPEN: 'No disponible' } as const;

function ProvidersHealthDTO({
  circuits,
  activeFallbacks,
  generatedAt
}: {
  circuits: CircuitStatus[];
  activeFallbacks: number;
  generatedAt: string;
}) {
  return {
    providers: circuits.map(c => ({
      product: c.product,
      availabilityStatus: AVAILABILITY[c.status],
      circuit: { state: c.status, failures: c.failures, openedAt: c.openedAtISO }
    })),
    activeFallbacks,
    generatedAt
  };
}

function FallbackEventDTO(row: ProviderFallbackEvent) {
  const startedAt = row.startedAt ? new Date(row.startedAt) : null;
  const endedAt = row.endedAt ? new Date(row.endedAt) : null;
  const MS_PER_SECOND = 1000;
  return {
    fallbackEventId: row.providerFallbackEventId,
    provider: row.provider,
    circuitProduct: row.circuitProduct,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    active: row.endedAt === null,
    durationSeconds: startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / MS_PER_SECOND) : null,
    affectedProcessesCount: row.affectedProcessesCount
  };
}

// ============================================================
// ESQUEMAS DE SALIDA — describen (y documentan) lo que arman las funciones de arriba
// ============================================================

const CircuitView = z.object({
  state: z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']),
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
      availabilityStatus: z.enum(['Disponible', 'Degradado', 'No disponible']),
      circuit: CircuitView
    })
  ),
  activeFallbacks: z.number().int().meta({ description: 'Caídas abiertas (provider_fallback_events sin fin).' }),
  generatedAt: z.string()
});

export default { ProvidersHealthDTO, FallbackEventDTO };
