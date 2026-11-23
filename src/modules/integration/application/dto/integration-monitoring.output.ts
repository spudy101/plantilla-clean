// Salidas de los casos de uso del monitoreo de proveedores (datos planos). La presentación las documenta
// con los esquemas Zod de presentation/http/responses/.
import type { FallbackEvent } from '../../domain/fallback-event';
import { availabilityOf, type CircuitSnapshot } from '../../domain/provider-health';

/** Valores posibles del estado del circuito y de la disponibilidad (para los esquemas de la presentación). */
export { AVAILABILITY_STATUSES, CIRCUIT_STATES } from '../../domain/provider-health';

export function toFallbackEventOutput(event: FallbackEvent) {
  return {
    fallbackEventId: event.fallbackEventId,
    provider: event.provider,
    circuitProduct: event.circuitProduct,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    active: event.isActive,
    durationSeconds: event.durationSeconds,
    affectedProcessesCount: event.affectedProcessesCount
  };
}
export type FallbackEventOutput = ReturnType<typeof toFallbackEventOutput>;

export function toProviderHealthOutput(circuit: CircuitSnapshot) {
  return {
    product: circuit.product,
    availabilityStatus: availabilityOf(circuit.state),
    circuit: {
      state: circuit.state,
      failures: circuit.failures,
      openedAt: circuit.openedAt ? circuit.openedAt.toISOString() : null
    }
  };
}

export function toProvidersHealthOutput({
  circuits,
  activeFallbacks,
  generatedAt
}: {
  circuits: CircuitSnapshot[];
  activeFallbacks: number;
  generatedAt: Date;
}) {
  return { providers: circuits.map(toProviderHealthOutput), activeFallbacks, generatedAt: generatedAt.toISOString() };
}
export type ProvidersHealthOutput = ReturnType<typeof toProvidersHealthOutput>;
