// Crear una notificación: lo que usan todos los módulos para avisar (por el puerto Notifier) y el panel admin.
//
//   CreateNotification  → a un usuario (bandeja + entregas por canal) o, sin usuario, a todos (global + envío
//                         masivo). Las plantillas y los canales los define el tipo.
//   SendDirectEmail     → directo por email a una dirección, sin usuario ni preferencias (p. ej. a la de una
//                         cuenta recién eliminada). No queda en ninguna bandeja.
//
// Si quien llama ya está en una unidad de trabajo, su commit llega después: no se envía desde acá y lo toma el
// despachador en su próximo ciclo.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import { BROADCAST_LEASE_MS } from '../../domain/broadcast';
import type { RelatedEntity } from '../../domain/notification';
import { categorySupports, renderContent, type NotificationType } from '../../domain/notification-type';
import { NotificationTypeCodeNotFoundError, NotificationTypeRequiredError, RecipientEmailRequiredError } from '../../domain/errors';
import type { NotificationCreated } from '../dto/notification.output';
import type { NotificationTypeRepository } from '../ports/notification-catalog-repository.port';
import type { GlobalNotificationRepository, PersonalNotificationRepository } from '../ports/inbox-repository.port';
import type { NotificationPreferenceRepository } from '../ports/preference-repository.port';
import type { ContactCipher, TransactionProbe } from '../ports/runtime.port';
import type { DeliveryAttempts, ScheduleDeliveries } from './deliveries.use-cases';
import type { BroadcastGlobalNotification } from './broadcast.use-cases';
import type { SendTemplatedEmail } from './send-templated-email.use-case';
import type { UnreadCounter } from './unread-counter';

const { errorMessage } = errorMessageModule;

export interface CreateNotificationInput {
  /** Código del tipo de notificación. */
  type: string;
  /** null o ausente → notificación global (a todos). */
  userId?: string | null;
  relatedEntity?: RelatedEntity | null;
  /** Variables de las plantillas ({{variable}}). */
  metadata?: Record<string, unknown>;
}

const errorLog = (error: unknown) => ({ error: errorMessage(error), stack: error instanceof Error ? error.stack : undefined });

export interface CreateNotificationDeps {
  types: Pick<NotificationTypeRepository, 'findActiveByCode'>;
  personal: Pick<PersonalNotificationRepository, 'create'>;
  globals: Pick<GlobalNotificationRepository, 'create'>;
  preferences: Pick<NotificationPreferenceRepository, 'findByUser'>;
  unitOfWork: UnitOfWork;
  transaction: TransactionProbe;
  schedule: Pick<ScheduleDeliveries, 'execute'>;
  attempts: Pick<DeliveryAttempts, 'sendInBackground'>;
  broadcast: Pick<BroadcastGlobalNotification, 'sendInBackground'>;
  unread: Pick<UnreadCounter, 'refreshLater' | 'invalidateAllLater'>;
  logger: Logger;
}

export class CreateNotification {
  constructor(private readonly deps: CreateNotificationDeps) {}

  async execute(input: CreateNotificationInput): Promise<NotificationCreated> {
    try {
      // Los defaults solo para lo ausente (un null explícito sigue siendo null, como siempre)
      const { type: code, userId = null, relatedEntity = {}, metadata = {} } = input;
      if (!code) {
        throw new NotificationTypeRequiredError();
      }
      const type = await this.deps.types.findActiveByCode(code);
      if (!type) {
        throw new NotificationTypeCodeNotFoundError(code);
      }

      const { title, body } = renderContent(type, metadata);
      const created = userId
        ? await this.toUser(userId, type, title, body, relatedEntity, metadata)
        : await this.toEveryone(type, title, body, metadata);

      this.deps.logger.info('Notificación creada exitosamente', {
        notificationId: 'notificationId' in created ? created.notificationId : created.globalNotificationId,
        tipo: code,
        userId,
        isGlobal: !userId
      });
      return { estadoSolicitud: 1, message: 'Notificación creada exitosamente.', ...created };
    } catch (error) {
      this.deps.logger.error('Error al crear notificación', errorLog(error));
      throw error;
    }
  }

  private async toUser(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    relatedEntity: RelatedEntity | null,
    metadata: Record<string, unknown>
  ) {
    const { unitOfWork, personal, schedule } = this.deps;
    const canSendNow = !this.deps.transaction.inTransaction();
    const preference = await this.deps.preferences.findByUser(userId);

    // La notificación in-app y sus entregas en la misma transacción: si el proceso muere antes de enviar, el
    // despachador las encuentra y las envía igual.
    const { notification, deliveries, sendNow } = await unitOfWork.run(async () => {
      const row = await personal.create({
        userId,
        notificationTypeId: type.notificationTypeId,
        title,
        body,
        relatedEntityType: relatedEntity?.type || null,
        relatedEntityId: relatedEntity?.id || null,
        metadata
      });
      const scheduled = await schedule.execute(row.notificationId, type.category, preference, { canSendNow });
      return { notification: { ...row, notificationType: type }, ...scheduled };
    });
    if (sendNow) {
      this.deps.attempts.sendInBackground(deliveries, notification);
    }
    this.deps.unread.refreshLater(userId);
    return { notificationId: notification.notificationId };
  }

  private async toEveryone(type: NotificationType, title: string, body: string, metadata: Record<string, unknown>) {
    // La global nace reservada para enviarla desde acá; dentro de una unidad de trabajo, pendiente para el despachador.
    const canSendNow = !this.deps.transaction.inTransaction();
    const created = await this.deps.globals.create({
      notificationTypeId: type.notificationTypeId,
      title,
      body,
      metadata,
      sendPush: categorySupports(type.category, 'push'),
      sendEmail: categorySupports(type.category, 'email'),
      reservedUntil: canSendNow ? new Date(Date.now() + BROADCAST_LEASE_MS) : null
    });
    if (canSendNow) {
      this.deps.broadcast.sendInBackground({ ...created, notificationType: type });
    }
    // Una sola fila para todos: cada conexión abierta recalcula su propio contador.
    this.deps.unread.invalidateAllLater();
    return { globalNotificationId: created.globalNotificationId };
  }
}

export class SendDirectEmail {
  constructor(
    private readonly types: Pick<NotificationTypeRepository, 'findActiveByCode'>,
    private readonly email: Pick<SendTemplatedEmail, 'execute'>,
    private readonly cipher: Pick<ContactCipher, 'reveal'>,
    private readonly logger: Logger
  ) {}

  async execute({ type: code, email, metadata = {} }: { type: string; email: string; metadata?: Record<string, unknown> }) {
    try {
      if (!code) {
        throw new NotificationTypeRequiredError();
      }
      if (!email) {
        throw new RecipientEmailRequiredError();
      }
      const type = await this.types.findActiveByCode(code);
      if (!type) {
        throw new NotificationTypeCodeNotFoundError(code);
      }
      // La dirección puede llegar cifrada (de una lectura que no pasó por el descifrado): se envía en claro.
      const to = this.cipher.reveal(email);
      await this.email.execute(to, type, metadata);
      this.logger.info('Notificación directa enviada exitosamente', { tipo: code, email: to });
      return { estadoSolicitud: 1 as const, message: 'Notificación enviada exitosamente por email.' };
    } catch (error) {
      this.logger.error('Error al enviar notificación directa', errorLog(error));
      throw error;
    }
  }
}
