// Lo que el circuit breaker (shared/infrastructure) avisa cuando un circuito se abre o se cierra, conectado a
// los casos de uso de integration. src/main/app.ts lo registra con CircuitBreaker.registerCallbacks().
//
// Cada aviso corre como su propia operación de sistema y nunca lanza: el breaker no debe fallar porque no
// se pudo registrar la ventana. Un error se loguea.
import { runOperation } from '../../../../shared/infrastructure/observability/operation';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { RecordFallbackOpened } from '../../application/use-cases/record-fallback-opened.use-case';
import type { RecordFallbackResolved } from '../../application/use-cases/record-fallback-resolved.use-case';

const { errorMessage } = errorMessageModule;

export interface CircuitBreakerListener {
  onOpen(product: string, openedAt: number): Promise<void>;
  onClose(product: string, openedAt: number): Promise<void>;
}

export function createFallbackCircuitListener(
  { recordOpened, recordResolved }: { recordOpened: RecordFallbackOpened; recordResolved: RecordFallbackResolved },
  logger: Logger
): CircuitBreakerListener {
  return {
    onOpen: (product, openedAt) =>
      runOperation({ source: 'system', name: 'circuit-breaker.fallback-open' }, async () => {
        try {
          await recordOpened.execute({ product, openedAt: new Date(openedAt) });
        } catch (err) {
          logger.error('[ProviderFallback] Error registrando la apertura', { product, error: errorMessage(err) });
        }
      }),

    onClose: (product, openedAt) =>
      runOperation({ source: 'system', name: 'circuit-breaker.fallback-close' }, async () => {
        try {
          await recordResolved.execute({ product, openedAt: new Date(openedAt) });
        } catch (err) {
          logger.error('[ProviderFallback] Error registrando el cierre', { product, error: errorMessage(err) });
        }
      })
  };
}
