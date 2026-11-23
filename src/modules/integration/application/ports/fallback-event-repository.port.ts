// Puerto de persistencia de las ventanas de fallback (provider_fallback_events). Lo implementa
// infrastructure/persistence/prisma-fallback-event.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { FallbackEvent } from '../../domain/fallback-event';

export interface FallbackEventPage {
  rows: FallbackEvent[];
  count: number;
}

/** Filtros del historial; null o false = sin ese filtro. */
export interface FallbackHistoryFilters {
  provider: string | null;
  activeOnly: boolean;
  from: Date | null;
  to: Date | null;
}

export interface FallbackOpening {
  provider: string;
  circuitProduct: string;
  startedAt: Date;
}

export interface FallbackClosing {
  provider: string;
  /** Cuándo se abrió el circuito: se cierra la ventana abierta desde entonces (con tolerancia de relojes). */
  startedAt: Date | null;
  endedAt: Date;
  affectedCount: number | null;
}

export interface FallbackEventRepository {
  open(opening: FallbackOpening): Promise<FallbackEvent>;

  /** Cierra la ventana abierta más reciente del proveedor; null si no hay ninguna. */
  closeLatestOpen(closing: FallbackClosing): Promise<FallbackEvent | null>;

  /** Cuántas ventanas siguen abiertas. */
  countActive(): Promise<number>;

  list(filters: FallbackHistoryFilters, page: PageRequest): Promise<FallbackEventPage>;
}
