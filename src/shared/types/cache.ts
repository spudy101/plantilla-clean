// shared/types/cache.ts
//
// Contrato mínimo de caché clave-valor que cumplen tanto redis.util (async) como cache.util (local,
// síncrono). Quien lo use debe tratar cada resultado como posible Promise: `await cache.get(k)` o
// `Promise.resolve(cache.del(k))` — nunca encadenar `.then/.catch` directo sobre el retorno.

export interface KeyValueCache {
  get(key: string): unknown;
  set(key: string, value: unknown, ttl?: number | null): unknown;
  del(key: string): unknown;
}
