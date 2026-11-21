// Contrato de reintento de la API: cómo sabe un consumidor si un error es temporal o permanente.
//
// Toda respuesta de error trae `retryable` en el body:
//   true  → temporal: reintentar la MISMA petición puede funcionar. Si viene el header `Retry-After`
//           (segundos), esperar al menos eso; si no, backoff exponencial con jitter.
//   false → permanente: repetirla da el mismo resultado; hay que cambiar algo (datos, permisos, código).
//
// Por defecto se decide por el status; un error puede declararlo distinto (p. ej. un 409 de "la misma
// petición sigue en curso" es temporal). Ver docs/errors-and-retries.md.

/** 408 Request Timeout, 429 Too Many Requests, 502/503/504 (gateway, no disponible, timeout). */
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

function isRetryableStatus(statusCode: number): boolean {
  return RETRYABLE_STATUSES.has(statusCode);
}

/** Segundos enteros (≥ 1) para el header Retry-After a partir de milisegundos. */
function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export { isRetryableStatus, retryAfterSeconds };
export default { isRetryableStatus, retryAfterSeconds };
