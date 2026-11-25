// Cuánto esperar antes de reintentar, en segundos enteros (≥ 1), a partir de milisegundos. Es lo que viaja en el
// header Retry-After, pero el cálculo no sabe de HTTP: lo usan el circuit breaker (infraestructura) y la presentación.
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}
