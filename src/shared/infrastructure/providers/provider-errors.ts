// Cómo leer el error de un proveedor externo. Lógica pura, sin dependencias de infraestructura:
//   isTransientError → ¿el proveedor está mal? Decide si reintentar y si cuenta para el circuit breaker.
//   providerFailure  → qué error lanzar cuando la llamada falló: no disponible (temporal) o interno.
import { InternalError } from '../../domain/errors/domain-error';
import { isExpectedError, ServiceUnavailableError, type ExpectedError } from '../../application/errors';

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_SERVER_ERROR = 500;
const THROTTLING_NAMES = new Set([
  'ThrottlingException',
  'Throttling',
  'TooManyRequestsException',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'SlowDown'
]);

/**
 * ¿El error dice que el proveedor está mal (vale reintentar y cuenta para el circuito)?
 * Sí: throttling, 5xx, 408/429, timeouts y errores de red (sin respuesta HTTP).
 * No: el resto de 4xx — el proveedor respondió y el problema es la petición.
 */
function isTransientError(error: unknown): boolean {
  const e = error as { name?: string; $retryable?: unknown; $fault?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (!e || typeof e !== 'object') {
    return true;
  }
  if (e.$retryable || (e.name && THROTTLING_NAMES.has(e.name))) {
    return true;
  }
  const status = e.$metadata?.httpStatusCode;
  if (status) {
    return status >= HTTP_SERVER_ERROR || status === HTTP_TOO_MANY_REQUESTS || status === HTTP_REQUEST_TIMEOUT;
  }
  if (e.$fault) {
    return e.$fault === 'server';
  }
  return true;
}

// Señales de que el error vino del proveedor o del camino hasta él (y no de nuestro código).
const TIMEOUT_NAMES = new Set(['TimeoutError', 'AbortError']);
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN'
]);

function cameFromProvider(error: unknown): boolean {
  const e = error as { name?: string; code?: string; $metadata?: unknown; $fault?: unknown } | null;
  return Boolean(
    e &&
    typeof e === 'object' &&
    (e.$metadata !== undefined ||
      e.$fault !== undefined ||
      (e.name && TIMEOUT_NAMES.has(e.name)) ||
      (e.code && NETWORK_CODES.has(e.code)))
  );
}

/**
 * El error a lanzar cuando falló una llamada a un proveedor. Uno que ya dice qué responder (CircuitOpenError
 * incluido, o uno de negocio) sale tal cual. Si el proveedor estaba mal (transitorio: caído, throttling, timeout,
 * red) no está disponible y vale reintentar (la presentación responde 503); si no (petición rechazada, o un bug
 * nuestro), es un error interno (500). Antes todo era 500 y el cliente no reintentaba algo que sí podía funcionar.
 */
function providerFailure(error: unknown, message: string): ExpectedError {
  if (isExpectedError(error)) {
    return error;
  }
  return cameFromProvider(error) && isTransientError(error) ? new ServiceUnavailableError(message) : new InternalError(message, 'INTERNAL_ERROR');
}

export { isTransientError, providerFailure };
export default { isTransientError, providerFailure };
