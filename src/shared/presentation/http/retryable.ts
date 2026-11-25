// Contrato de reintento de la API: cómo sabe un consumidor si un error es temporal o permanente.
//
// Toda respuesta de error trae `retryable` en el body:
//   true  → temporal: reintentar la MISMA petición puede funcionar. Si viene el header `Retry-After`
//           (segundos), esperar al menos eso; si no, backoff exponencial con jitter.
//   false → permanente: repetirla da el mismo resultado; hay que cambiar algo (datos, permisos, código).
//
// Por defecto se decide por el status; un error puede declararlo distinto (p. ej. un 409 de "la misma
// petición sigue en curso" es temporal). Ver docs/errors-and-retries.md.
import { retryAfterSeconds } from '../../kernel/retry-after';

const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
const BAD_GATEWAY = 502;
const SERVICE_UNAVAILABLE = 503;
const GATEWAY_TIMEOUT = 504;

/** Los status temporales: el servidor (o algo detrás de él) no pudo atender ahora, no la petición en sí. */
const RETRYABLE_STATUSES = new Set([REQUEST_TIMEOUT, TOO_MANY_REQUESTS, BAD_GATEWAY, SERVICE_UNAVAILABLE, GATEWAY_TIMEOUT]);

function isRetryableStatus(statusCode: number): boolean {
  return RETRYABLE_STATUSES.has(statusCode);
}

export { isRetryableStatus, retryAfterSeconds };
export default { isRetryableStatus, retryAfterSeconds };
