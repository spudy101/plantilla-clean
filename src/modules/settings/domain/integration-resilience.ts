// Value object: la política de resiliencia de TODAS las llamadas a proveedores externos (timeout,
// reintentos y umbrales del circuit breaker). Un solo valor para todos los proveedores.
//
// Es inmutable y se compara por valor. Cada campo es opcional: lo que nunca se configuró queda sin valor y
// quien la consume (shared/infrastructure/providers/resilience-config.util) usa su default.

export interface CircuitBreakerPolicy {
  /** Fallos seguidos para abrir el circuito. */
  failureThreshold?: number;
  /** Cuánto esperar con el circuito abierto antes de probar de nuevo (ms). */
  recoveryTimeMs?: number;
  /** Ventana en la que se cuentan los fallos (s). */
  failuresTtlS?: number;
}

export interface IntegrationResilienceProps {
  /** Timeout de cada intento (ms). */
  timeoutMs?: number;
  /** Intentos por llamada, solo ante errores transitorios. */
  maxRetries?: number;
  circuitBreaker?: CircuitBreakerPolicy;
}

/** Cambios pedidos: lo que no viene se conserva. */
export type IntegrationResiliencePatch = IntegrationResilienceProps;

export class IntegrationResilience {
  private constructor(private readonly props: Readonly<IntegrationResilienceProps>) {}

  static of(props: IntegrationResilienceProps = {}): IntegrationResilience {
    return new IntegrationResilience({
      ...props,
      ...(props.circuitBreaker ? { circuitBreaker: { ...props.circuitBreaker } } : {})
    });
  }

  get timeoutMs(): number | undefined {
    return this.props.timeoutMs;
  }

  get maxRetries(): number | undefined {
    return this.props.maxRetries;
  }

  get circuitBreaker(): Readonly<CircuitBreakerPolicy> | undefined {
    return this.props.circuitBreaker;
  }

  /** true si nunca se configuró nada. */
  isEmpty(): boolean {
    return this.props.timeoutMs === undefined && this.props.maxRetries === undefined && this.props.circuitBreaker === undefined;
  }

  /**
   * Merge parcial: lo enviado reemplaza, lo no enviado se conserva. El circuit breaker se fusiona campo a
   * campo (cambiar solo `failureThreshold` no borra `recoveryTimeMs`).
   */
  merge(patch: IntegrationResiliencePatch): IntegrationResilience {
    const merged: IntegrationResilienceProps = { ...this.props };
    if (patch.timeoutMs !== undefined) {
      merged.timeoutMs = patch.timeoutMs;
    }
    if (patch.maxRetries !== undefined) {
      merged.maxRetries = patch.maxRetries;
    }
    if (patch.circuitBreaker !== undefined) {
      const cb: CircuitBreakerPolicy = { ...this.props.circuitBreaker };
      if (patch.circuitBreaker.failureThreshold !== undefined) {
        cb.failureThreshold = patch.circuitBreaker.failureThreshold;
      }
      if (patch.circuitBreaker.recoveryTimeMs !== undefined) {
        cb.recoveryTimeMs = patch.circuitBreaker.recoveryTimeMs;
      }
      if (patch.circuitBreaker.failuresTtlS !== undefined) {
        cb.failuresTtlS = patch.circuitBreaker.failuresTtlS;
      }
      merged.circuitBreaker = cb;
    }
    return IntegrationResilience.of(merged);
  }

  toProps(): IntegrationResilienceProps {
    return { ...this.props, ...(this.props.circuitBreaker ? { circuitBreaker: { ...this.props.circuitBreaker } } : {}) };
  }
}
