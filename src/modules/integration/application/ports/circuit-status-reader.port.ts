// Puerto: el estado en vivo del circuit breaker de cada proveedor. Lo implementa
// infrastructure/circuit-breaker/circuit-breaker-status.reader.ts con el breaker de shared/.
import type { CircuitSnapshot } from '../../domain/provider-health';

export interface CircuitStatusReader {
  /** Un snapshot por proveedor externo, en el orden en que se declaran los proveedores. */
  readAll(): Promise<CircuitSnapshot[]>;
}
