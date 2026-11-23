// Adaptador del puerto CircuitStatusReader con el circuit breaker de shared/ (estado en Redis o en memoria).
import CircuitBreaker from '../../../../shared/infrastructure/providers/circuit-breaker.util';
import { PROVIDER_PRODUCTS } from '../../../../shared/infrastructure/providers/provider-call.util';
import type { CircuitStatusReader } from '../../application/ports/circuit-status-reader.port';
import type { CircuitSnapshot } from '../../domain/provider-health';

type BreakerStatus = Awaited<ReturnType<typeof CircuitBreaker.getStatus>>;

export function toCircuitSnapshot(status: BreakerStatus): CircuitSnapshot {
  return {
    product: status.product,
    state: status.status,
    failures: status.failures,
    openedAt: status.openedAt === null ? null : new Date(status.openedAt)
  };
}

export class CircuitBreakerStatusReader implements CircuitStatusReader {
  constructor(private readonly breaker: Pick<typeof CircuitBreaker, 'getStatus'> = CircuitBreaker) {}

  async readAll(): Promise<CircuitSnapshot[]> {
    const statuses = await Promise.all(PROVIDER_PRODUCTS.map(product => this.breaker.getStatus(product)));
    return statuses.map(toCircuitSnapshot);
  }
}
