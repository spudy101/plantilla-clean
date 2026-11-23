// tests/doubles/integration.doubles.ts
//
// Dobles en memoria de los puertos de integration, para los tests de los casos de uso.
import type { PageRequest } from '../../src/shared/application/pagination';
import type {
  FallbackClosing,
  FallbackEventRepository,
  FallbackHistoryFilters,
  FallbackOpening
} from '../../src/modules/integration/application/ports/fallback-event-repository.port';
import type { CircuitStatusReader } from '../../src/modules/integration/application/ports/circuit-status-reader.port';
import type { FailedProcessCounter } from '../../src/modules/integration/application/ports/failed-process-counter.port';
import { FallbackEvent, type FallbackEventProps } from '../../src/modules/integration/domain/fallback-event';
import type { CircuitSnapshot } from '../../src/modules/integration/domain/provider-health';

export const fallbackEvent = (over: Partial<FallbackEventProps> = {}) =>
  FallbackEvent.restore({
    fallbackEventId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    provider: 'aws_ses',
    circuitProduct: 'ses',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    endedAt: null,
    affectedProcessesCount: null,
    ...over
  });

/** Ventanas en memoria: guarda lo que se abrió, se cerró y con qué filtros se listó. */
export class InMemoryFallbackEvents implements FallbackEventRepository {
  readonly opened: FallbackOpening[] = [];
  readonly closed: FallbackClosing[] = [];
  readonly listCalls: { filters: FallbackHistoryFilters; page: PageRequest }[] = [];
  failOpen = false;

  constructor(public events: FallbackEvent[] = []) {}

  async open(opening: FallbackOpening) {
    if (this.failOpen) {
      throw new Error('BD caída');
    }
    this.opened.push(opening);
    const event = fallbackEvent({ ...opening, fallbackEventId: `f-${this.opened.length}` });
    this.events.push(event);
    return event;
  }

  async closeLatestOpen(closing: FallbackClosing) {
    this.closed.push(closing);
    return null;
  }

  async countActive() {
    return this.events.filter(e => e.isActive).length;
  }

  async list(filters: FallbackHistoryFilters, page: PageRequest) {
    this.listCalls.push({ filters, page });
    return { rows: this.events, count: this.events.length };
  }
}

export class FixedCircuits implements CircuitStatusReader {
  constructor(public snapshots: CircuitSnapshot[]) {}
  async readAll() {
    return this.snapshots;
  }
}

/** Cuenta fija de procesos fallidos (o un error), y anota qué se le preguntó. */
export class StubFailedProcesses implements FailedProcessCounter {
  readonly asked: string[] = [];
  constructor(private readonly result: number | null | Error = null) {}
  async countFailedBetween(product: string) {
    this.asked.push(product);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}
