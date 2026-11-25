// Crons de notificaciones: programa los casos de uso del despachador y de retención. src/main/server.ts lo inicia.
//
//   cada minuto   envía las entregas vencidas (diferidas por horario de silencio, reintentos y las que quedaron a
//                 medias si el proceso murió; cada una la toma una sola instancia) y retoma los envíos masivos de
//                 globales pendientes o interrumpidos, desde su cursor
//   03:00         borra las notificaciones leídas antiguas y los dispositivos push inactivos
//   04:00         borra los códigos de verificación vencidos o ya usados
import cron from 'node-cron';
import { runOperation } from '../../../../shared/infrastructure/observability/operation';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { DispatchDueDeliveries } from '../../application/use-cases/deliveries.use-cases';
import type { BroadcastGlobalNotification } from '../../application/use-cases/broadcast.use-cases';
import type { PurgeOldNotifications, PurgeVerificationCodes } from '../../application/use-cases/cleanup.use-cases';

const { errorMessage } = errorMessageModule;

export interface NotificationWorker {
  start(): void;
}

export function createNotificationWorker(
  {
    dispatchDeliveries,
    broadcast,
    purgeNotifications,
    purgeCodes
  }: {
    dispatchDeliveries: DispatchDueDeliveries;
    broadcast: Pick<BroadcastGlobalNotification, 'dispatchDue'>;
    purgeNotifications: PurgeOldNotifications;
    purgeCodes: PurgeVerificationCodes;
  },
  logger: Logger
): NotificationWorker {
  return {
    start() {
      // Solo los ciclos con entregas se registran como operación: uno vacío por minuto no deja traza.
      cron.schedule('* * * * *', async () => {
        try {
          const { attempted } = await dispatchDeliveries.execute(send => runOperation({ source: 'worker', name: 'notification.dispatch' }, send));
          const { resumed } = await broadcast.dispatchDue(send => runOperation({ source: 'worker', name: 'notification.global-dispatch' }, send));
          if (attempted > 0 || resumed > 0) {
            logger.info('Notificaciones despachadas', { attempted, resumed });
          }
        } catch (error) {
          // Falló la toma (p. ej. base no disponible): el próximo ciclo lo vuelve a intentar.
          logger.error('[worker] notification.dispatch no pudo tomar entregas', { error: errorMessage(error) });
        }
      });

      cron.schedule('0 3 * * *', () =>
        runOperation({ source: 'worker', name: 'notification.cleanup' }, async () => {
          logger.info('Ejecutando worker: limpieza de notificaciones antiguas');
          await purgeNotifications.execute();
        })
      );

      cron.schedule('0 4 * * *', () =>
        runOperation({ source: 'worker', name: 'notification.cleanup-codes' }, async () => {
          logger.info('Ejecutando worker: limpieza de codigos de verificacion');
          const result = await purgeCodes.execute();
          logger.info('Worker limpieza codigos completado', result);
        })
      );

      logger.info('Workers de notificaciones iniciados exitosamente');
    }
  };
}
