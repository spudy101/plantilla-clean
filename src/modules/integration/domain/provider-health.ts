// Salud de un proveedor según su circuit breaker: el semáforo que ve el administrador.
//
// El estado del circuito es técnico (CLOSED / HALF_OPEN / OPEN); la disponibilidad es lo que significa para
// el negocio. Ese significado es una regla y vive acá.

export const CIRCUIT_STATES = ['CLOSED', 'OPEN', 'HALF_OPEN'] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export const AVAILABILITY_STATUSES = ['Disponible', 'Degradado', 'No disponible'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

const AVAILABILITY: Readonly<Record<CircuitState, AvailabilityStatus>> = Object.freeze({
  CLOSED: 'Disponible',
  HALF_OPEN: 'Degradado',
  OPEN: 'No disponible'
});

/** Cerrado → disponible; en prueba → degradado; abierto → no disponible. */
export function availabilityOf(state: CircuitState): AvailabilityStatus {
  return AVAILABILITY[state];
}

/** Lo que se sabe del circuito de un producto en este momento. */
export interface CircuitSnapshot {
  product: string;
  state: CircuitState;
  /** Fallos seguidos en la ventana de conteo. */
  failures: number;
  /** Desde cuándo está abierto; null si está cerrado. */
  openedAt: Date | null;
}
