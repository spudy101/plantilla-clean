import { interopDefault } from '../../../shared/kernel/interop.util';
import type { NotificationTypeWithCategory } from '../repositories/notification-type.repository';
import type { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import notificationRepo from '../repositories/notification.repository';
import globalNotificationRepo from '../repositories/global-notification.repository';
import notificationTypeRepo from '../repositories/notification-type.repository';
import userNotificationPreferenceRepo from '../repositories/user-notification-preference.repository';
import NotificationCountUtil from '../utils/notification-count.util';
import notificationDeliveryService from './notification-delivery.service';
import unitOfWork from '../../../shared/infrastructure/database/unit-of-work';
import txContext from '../../../shared/infrastructure/database/transaction-context';
import NotificationContentUtil from '../utils/notification-content.util';
import EncryptionUtil from '../../../shared/infrastructure/security/encryption.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import AppError from '../../../shared/presentation/http/app-error.util';
import errorMessageModule from '../../../shared/kernel/error-message.util';
import type { NotificationCreated } from '../responses/notification.response';

const { errorMessage } = errorMessageModule;


class NotificationCreationService {
  notificationRepo: typeof notificationRepo;
  globalNotificationRepo: typeof globalNotificationRepo;
  notificationTypeRepo: typeof notificationTypeRepo;
  userNotificationPreferenceRepo: typeof userNotificationPreferenceRepo;
  notificationDeliveryService: typeof notificationDeliveryService;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new NotificationCreationService({ notificationRepo: fake })
   * @param {object} [deps]
   */
  constructor(deps: NotificationCreationService.Deps = {}) {
    this.notificationRepo = deps.notificationRepo ?? notificationRepo;
    this.globalNotificationRepo = deps.globalNotificationRepo ?? globalNotificationRepo;
    this.notificationTypeRepo = deps.notificationTypeRepo ?? notificationTypeRepo;
    this.userNotificationPreferenceRepo = deps.userNotificationPreferenceRepo ?? userNotificationPreferenceRepo;
    this.notificationDeliveryService = deps.notificationDeliveryService ?? notificationDeliveryService;
  }

  /**
   * Crea y envía una notificación directa por email sin guardarla en BD
   * Útil para cuentas eliminadas u otros casos donde el usuario ya no existe
   *
   * @param {Object} data
   * @param {string} data.tipoNotificacion
   * @param {string} data.email
   * @param {Object} [data.metadata]
   */
  async crearNotificacionDirecta(data: { tipoNotificacion: string; email: string; metadata?: Record<string, unknown> }) {
    try {
      const { tipoNotificacion, email, metadata = {} } = data;

      if (!tipoNotificacion) {
        throw AppError.badRequest('tipoNotificacion es requerido');
      }
      if (!email) {
        throw AppError.badRequest('email es requerido');
      }

      const notificationType = await this.notificationTypeRepo.findByCode(tipoNotificacion);
      if (!notificationType) {
        throw AppError.notFound(`Tipo de notificación no encontrado: ${tipoNotificacion}`);
      }

      // El email puede llegar cifrado (formato GCM ivHex:authTagHex:cipherHex) cuando proviene
      // de un include anidado donde el hook afterFind de PersonContact no se ejecuta (ej:
      // deleteAccount). SES interpreta los ':' como grupos anidados → 'Nested group'. Descifrar
      // antes de enviar; safeDecrypt es idempotente si ya viene en claro.
      const emailDestino = EncryptionUtil.safeDecrypt(email);

      // FIX: nombre de archivo corregido de emailNotification.service → email-notification.service
      const emailService = interopDefault(require('./email-notification.service') as typeof import('./email-notification.service'));
      await emailService.enviarNotificacion(emailDestino, notificationType, metadata);

      logger.info('Notificación directa enviada exitosamente', { tipo: tipoNotificacion, email: emailDestino });

      return {
        estadoSolicitud: 1,
        message: 'Notificación enviada exitosamente por email.'
      };
    } catch (error) {
      logger.error('Error al enviar notificación directa', {
        error: errorMessage(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Crea y envía una notificación (individual o global)
   *
   * @param {Object}      data
   * @param {string}      data.tipoNotificacion
   * @param {string|null} data.userId           - null → notificación global
   * @param {Object}      [data.relatedEntity]  - { type, id }
   * @param {Object}      [data.metadata]
   * Dentro de unitOfWork.run() la notificación se crea en su transacción (contexto de Prisma).
   */
  async crearNotificacion(data: NotificationCreationService.CreateInput) {
    try {
      const { tipoNotificacion, userId = null, relatedEntity = {}, metadata = {} } = data;

      if (!tipoNotificacion) {
        throw AppError.badRequest('tipoNotificacion es requerido');
      }

      const notificationType = await this.notificationTypeRepo.findByCode(tipoNotificacion);
      if (!notificationType) {
        throw AppError.notFound(`Tipo de notificación no encontrado: ${tipoNotificacion}`);
      }

      // Generar contenido desde templates
      const generated = NotificationContentUtil.generarContenido(notificationType, metadata);

      let result;
      if (userId) {
        result = await this._crearNotificacionIndividual(
          userId,
          notificationType,
          generated.title,
          generated.body,
          relatedEntity,
          metadata
        );
      } else {
        result = await this._crearNotificacionGlobal(notificationType, generated.title, generated.body, metadata);
      }

      logger.info('Notificación creada exitosamente', {
        notificationId: 'notificationId' in result ? result.notificationId : result.globalNotificationId,
        tipo: tipoNotificacion,
        userId,
        isGlobal: !userId
      });

      return {
        estadoSolicitud: 1,
        message: 'Notificación creada exitosamente.',
        ...result
      } satisfies NotificationCreated;
    } catch (error) {
      logger.error('Error al crear notificación', { error: errorMessage(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  async _crearNotificacionIndividual(
    userId: string,
    notificationType: NotificationTypeWithCategory,
    title: string,
    body: string,
    relatedEntity: NotificationCreationService.RelatedEntity | null | undefined,
    metadata: Record<string, unknown>
  ) {
    // 1. Notificación in-app (siempre) y 2. sus entregas por canal externo, en la misma transacción:
    //    si el proceso muere antes de enviar, el despachador las encuentra y las envía igual.
    // Si quien llama ya está en una unidad de trabajo, su commit llega después: no se envía desde aquí y
    // las entregas las toma el despachador en su próximo ciclo.
    const canSendNow = txContext.activeUnit() === null;
    const userPreference = await this.userNotificationPreferenceRepo.findByUser(userId);
    const { notification, deliveries, sendNow } = await unitOfWork.run(async () => {
      const created = await this.notificationRepo.create({
        userId,
        notificationTypeId: notificationType.notificationTypeId,
        title,
        body,
        relatedEntityType: relatedEntity?.type || null,
        relatedEntityId: relatedEntity?.id || null,
        metadata: metadata as Prisma.InputJsonValue
      });
      const scheduled = await this.notificationDeliveryService.schedule(
        created.notificationId,
        notificationType,
        userPreference,
        { canSendNow }
      );
      return { notification: { ...created, notificationType }, ...scheduled };
    });
    if (sendNow) {
      this.notificationDeliveryService.sendInBackground(deliveries, notification);
    }

    // 3. Refrescar el contador SSE del destinatario (side-effect de fondo, nunca en el flujo principal)
    setImmediate(() => NotificationCountUtil.emitCountUpdate(userId));

    return { notificationId: notification.notificationId };
  }

  /** @private */
  async _crearNotificacionGlobal(
    notificationType: NotificationTypeWithCategory,
    title: string,
    body: string,
    metadata: Record<string, unknown>
  ) {
    // Carga perezosa: el envío masivo importa el módulo iam, que a su vez usa notificaciones.
    const batchModule = require('./notification-batch.service') as typeof import('./notification-batch.service');
    const batchService = interopDefault(batchModule);

    // 1. La global, ya reservada para enviarla desde aquí. Si quien llama está en una unidad de trabajo
    //    (su commit llega después), queda pendiente sin reserva y la toma el despachador.
    const canSendNow = txContext.activeUnit() === null;
    const globalNotification = await this.globalNotificationRepo.create({
      notificationTypeId: notificationType.notificationTypeId,
      title,
      body,
      metadata: metadata as Prisma.InputJsonValue,
      sendPush: notificationType.category?.supportsPush ?? true,
      sendEmail: notificationType.category?.supportsEmail ?? true,
      ...(canSendNow ? { status: 'processing', lockedUntil: new Date(Date.now() + batchModule.LEASE_MS) } : {})
    });

    // 2. Envío masivo en segundo plano (si se interrumpe, el despachador lo retoma desde el cursor)
    if (canSendNow) {
      batchService.sendInBackground({ ...globalNotification, notificationType });
    }

    // 3. Aviso broadcast del contador: la global es una sola fila para todos, así que cada
    // conexión SSE abierta recalcula su propio count al recibir { global: true }.
    setImmediate(() => NotificationCountUtil.emitGlobalCountInvalidation());

    return { globalNotificationId: globalNotification.globalNotificationId };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationCreationService {
  /** Entidad de dominio a la que apunta la notificación (p. ej. una ApprovalRequest). */
  export interface RelatedEntity {
    type?: string | null;
    id?: string | null;
  }

  export interface CreateInput {
    /** code del notification_type */
    tipoNotificacion: string;
    /** null → notificación global (a todos) */
    userId?: string | null;
    relatedEntity?: RelatedEntity | null;
    /** Variables de los templates ({{variable}}) */
    metadata?: Record<string, unknown>;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    notificationRepo?: typeof notificationRepo;
    globalNotificationRepo?: typeof globalNotificationRepo;
    notificationTypeRepo?: typeof notificationTypeRepo;
    userNotificationPreferenceRepo?: typeof userNotificationPreferenceRepo;
    notificationDeliveryService?: typeof notificationDeliveryService;
  }
}

export default Object.assign(new NotificationCreationService(), { NotificationCreationService });
