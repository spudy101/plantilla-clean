import notificationRepo from '../repositories/notification.repository';
import globalNotificationRepo from '../repositories/global-notification.repository';
import notificationEmitter from './notification-emitter.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;


/**
 * Punto único de refresco del contador SSE de no leídas. Los flujos que alteran el contador
 * (crear notificación, marcar leídas) lo invocan SIEMPRE vía setImmediate — nunca await en el
 * flujo principal. Ninguna de las dos funciones lanza: un fallo acá no puede tumbar el request.
 */
class NotificationCountUtil {
  /**
   * Recalcula el contador del usuario (personales no leídas + globales no leídas) y lo publica
   * por el emitter (`count-updated`, Redis Pub/Sub) hacia las conexiones SSE abiertas.
   */
  static async emitCountUpdate(userId: string) {
    try {
      const [personalCount, globalCount] = await Promise.all([
        notificationRepo.countUnreadByUser(userId),
        globalNotificationRepo.countUnreadByUser(userId)
      ]);
      const count = personalCount + globalCount;

      notificationEmitter.emit('count-updated', { userId, count });

      // Observabilidad del contador SSE: si el count no se refleja en el front, este log dice si el server
      // emitió, con qué valor, por qué transporte (redis = cruza instancias; local = solo este proceso) y
      // cuántas conexiones SSE escuchan EN ESTA instancia. localListeners=0 con transporte 'local' en un
      // deploy multi-instancia ⇒ el stream vive en otra instancia y hace falta Redis Pub/Sub.
      logger.info('[NotificationCount] count-updated emitido', {
        userId,
        count,
        transport: notificationEmitter.useRedis ? 'redis' : 'local',
        localListeners: notificationEmitter.listenerCount('count-updated')
      });
    } catch (error) {
      logger.error('[NotificationCount] Error emitiendo count-updated', { userId, error: errorMessage(error) });
    }
  }

  /**
   * Aviso broadcast tras crear una notificación GLOBAL: es una sola fila para todos los usuarios,
   * así que no hay fan-out por destinatario. Cada conexión SSE abierta recibe `{ global: true }`
   * y recalcula su propio contador (ver streamUnreadCount en el controller de notificaciones).
   */
  static emitGlobalCountInvalidation() {
    try {
      notificationEmitter.emit('count-updated', { global: true });
    } catch (error) {
      logger.error('[NotificationCount] Error emitiendo invalidación global', { error: errorMessage(error) });
    }
  }
}

export default NotificationCountUtil;
