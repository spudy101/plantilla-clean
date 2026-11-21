// Configuración de resiliencia de las llamadas a proveedores externos: timeout, reintentos y umbrales
// del circuit breaker. Un solo valor para todos los proveedores, editable por el admin en settings
// (system_global_config.integration_resilience). La usan callProvider y el circuit breaker.
//
// Se lee en cada llamada saliente, así que se cachea 60s. Si no se puede leer (arranque, BD caída)
// se usa el último valor o los defaults: nunca queda sin umbrales.

import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../utils/error-message.util';

const { errorMessage } = errorMessageModule;

const CACHE_TTL_MS = 60000;

// Defaults si no hay configuración guardada (o no se puede leer).
const HARD_DEFAULTS = Object.freeze({
  timeoutMs: 30000,
  maxRetries: 3,
  circuitBreaker: Object.freeze({ failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 })
});

/** Configuración de resiliencia en camelCase (lo que consumen los clientes de integraciones). */
interface ResilienceConfig {
  /** Timeout de cada intento (callProvider). */
  timeoutMs: number;
  /** Intentos totales por llamada, incluido el primero (callProvider). */
  maxRetries: number;
  circuitBreaker: { failureThreshold: number; recoveryTimeMs: number; failuresTtlS: number };
}

/** Forma persistida (snake_case) en system_global_config.integration_resilience. */
interface StoredResilience {
  timeout_ms?: number;
  max_retries?: number;
  circuit_breaker?: { failure_threshold?: number; recovery_time_ms?: number; failures_ttl_s?: number };
}

let _cache: ResilienceConfig | null = null;
let _cacheAt = 0;

/**
 * De dónde sale la configuración persistida. La provee el módulo settings al arrancar la app
 * (src/app.ts → registerResilienceSource): shared/ no conoce los módulos. Sin fuente, los defaults.
 */
type ResilienceSource = () => Promise<unknown>;
let source: ResilienceSource | null = null;

function registerResilienceSource(fn: ResilienceSource): void {
  source = fn;
  _cache = null;
}

// camelCase para el consumo interno, a partir del snake_case persistido en la global.
async function _load(): Promise<ResilienceConfig> {
  // integration_resilience es JSONB: lo escribe el admin validado por su DTO
  const r = ((source ? await source() : null) ?? {}) as StoredResilience;
  const cb = r.circuit_breaker ?? {};
  return {
    timeoutMs: r.timeout_ms ?? HARD_DEFAULTS.timeoutMs,
    maxRetries: r.max_retries ?? HARD_DEFAULTS.maxRetries,
    circuitBreaker: {
      failureThreshold: cb.failure_threshold ?? HARD_DEFAULTS.circuitBreaker.failureThreshold,
      recoveryTimeMs: cb.recovery_time_ms ?? HARD_DEFAULTS.circuitBreaker.recoveryTimeMs,
      failuresTtlS: cb.failures_ttl_s ?? HARD_DEFAULTS.circuitBreaker.failuresTtlS
    }
  };
}

/**
 * Devuelve la config de resiliencia homologada (cacheada 60s). Nunca lanza: ante error usa el
 * último valor cacheado o el fallback duro.
 *
 */
async function get(): Promise<ResilienceConfig> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
    return _cache;
  }
  try {
    _cache = await _load();
    _cacheAt = Date.now();
  } catch (error) {
    logger.warn('[ResilienceConfig] No se pudo leer la global — usando el último valor o el fallback duro', {
      error: errorMessage(error)
    });
    return _cache ?? { ...HARD_DEFAULTS, circuitBreaker: { ...HARD_DEFAULTS.circuitBreaker } };
  }
  return _cache;
}

// Para tests / invalidación explícita si hiciera falta.
function _resetCache(): void {
  _cache = null;
  _cacheAt = 0;
}

export { registerResilienceSource };
export default { get, HARD_DEFAULTS, _resetCache, registerResilienceSource };
