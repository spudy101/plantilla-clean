// shared/utils/concurrency.util.ts
//
// Ejecuta `task` sobre cada elemento con a lo sumo `limit` en curso a la vez (p. ej. envíos a un
// proveedor: en paralelo para no ir de a uno, acotado para no saturarlo ni agotar el pool de la base).
// `task` no debería lanzar; si lanza, el error se propaga cuando terminan las que ya estaban en curso.

async function forEachWithConcurrency<T>(items: readonly T[], limit: number, task: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await task(item);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  const results = await Promise.allSettled(workers);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    throw failed.reason;
  }
}

export default { forEachWithConcurrency };
