// Puerto: cuántos procesos fallaron durante una ventana de fallback. Los datos son de otros módulos (hoy los
// intentos de SMS de notification); src/main/adapters/failed-process-counter.adapter.ts lo implementa.
export interface FailedProcessCounter {
  /** null si para ese producto no hay registro de intentos con el que contar. */
  countFailedBetween(product: string, from: Date, to: Date): Promise<number | null>;
}
