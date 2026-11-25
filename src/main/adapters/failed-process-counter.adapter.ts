// Adaptador: el puerto FailedProcessCounter de integration con los intentos de entrega de notification.
//
// Solo se sabe cuántos procesos fallaron para los productos con tabla de intentos propia (hoy SMS); para el
// resto, null.
import type { FailedProcessCounter } from '../../modules/integration/application/ports/failed-process-counter.port';
import type { ModuleRegistry } from './module-registry';

export function failedProcessCounterAdapter(modules: ModuleRegistry): FailedProcessCounter {
  return {
    countFailedBetween(product, from, to) {
      if (product !== 'aws_sms') {
        return Promise.resolve(null);
      }
      return modules.notification.useCases.countFailedSms.execute(from, to);
    }
  };
}
