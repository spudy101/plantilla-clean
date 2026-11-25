// Adaptador: el puerto FailedProcessCounter de integration con los intentos de entrega de notification.
//
// Solo se sabe cuántos procesos fallaron para los productos con tabla de intentos propia (hoy SMS); para el
// resto, null.
import notificationModule from '../../modules/notification';
import type { FailedProcessCounter } from '../../modules/integration/application/ports/failed-process-counter.port';

export const failedProcessCounterAdapter: FailedProcessCounter = {
  countFailedBetween(product, from, to) {
    if (product !== 'aws_sms') {
      return Promise.resolve(null);
    }
    return notificationModule.smsDeliveryAttemptRepository.countFailedBetween(from, to);
  }
};
