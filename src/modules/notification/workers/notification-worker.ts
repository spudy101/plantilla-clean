// Crons de notificaciones:
//   * despachador (cada minuto): envía las entregas vencidas — diferidas por horario de silencio,
//     reintentos, y las que quedaron a medias si el proceso murió. Seguro con varias instancias (cada
//     entrega la toma una sola, FOR UPDATE SKIP LOCKED). En el mismo ciclo retoma los envíos masivos de
//     notificaciones globales pendientes o interrumpidos, desde su cursor.
//   * limpiezas diarias (retención de notificaciones leídas y códigos de verificación vencidos).
import cron from 'node-cron';
import notificationDeliveryService from '../services/notification-delivery.service';
import notificationBatchService from '../services/notification-batch.service';
import notificationCleanupService from '../services/notification-cleanup.service';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import { runOperation } from '../../../shared/infrastructure/observability/operation';
import errorMessageModule from '../../../shared/kernel/error-message.util';
const { errorMessage } = errorMessageModule;

class NotificationWorker {
  static iniciar() {
    // Solo los ciclos con entregas se registran como operación: uno vacío por minuto no deja traza.
    cron.schedule('* * * * *', async () => {
      try {
        const { attempted } = await notificationDeliveryService.dispatchDue(send =>
          runOperation({ source: 'worker', name: 'notification.dispatch' }, send)
        );
        // Envíos masivos de globales pendientes o interrumpidos: se retoman desde su cursor
        const { resumed } = await notificationBatchService.dispatchDue(send =>
          runOperation({ source: 'worker', name: 'notification.global-dispatch' }, send)
        );
        if (attempted > 0 || resumed > 0) {
          logger.info('Notificaciones despachadas', { attempted, resumed });
        }
      } catch (error) {
        // Falló la toma (p. ej. base no disponible): el próximo ciclo lo vuelve a intentar.
        logger.error('[worker] notification.dispatch no pudo tomar entregas', { error: errorMessage(error) });
      }
    });

    // Limpieza de notificaciones antiguas - diario a las 3 AM
    cron.schedule('0 3 * * *', () =>
      runOperation({ source: 'worker', name: 'notification.cleanup' }, async () => {
        logger.info('Ejecutando worker: limpieza de notificaciones antiguas');
        await notificationCleanupService.limpiarNotificacionesAntiguas();
      })
    );

    // Limpieza de codigos de verificacion - diario a las 4 AM
    cron.schedule('0 4 * * *', () =>
      runOperation({ source: 'worker', name: 'notification.cleanup-codes' }, async () => {
        logger.info('Ejecutando worker: limpieza de codigos de verificacion');
        const result = await notificationCleanupService.limpiarCodigosVerificacion();
        logger.info('Worker limpieza codigos completado', result);
      })
    );

    logger.info('Workers de notificaciones iniciados exitosamente');
  }
}

export default NotificationWorker;
