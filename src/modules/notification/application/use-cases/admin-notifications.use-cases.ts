// Lo que el panel admin y otros sistemas hacen con las notificaciones: avisos a todos o a un usuario (tipo
// NOTIFICACION_GENERAL), la creación por un servicio externo (X-API-Key) y la consulta de las entregas
// (soporte: "¿le llegó?"; solo lectura, los reintentos son automáticos).
import { pageOf, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { DeliveryStatus } from '../../domain/delivery';
import type { Channel } from '../../domain/notification-type';
import { DeliveryNotFoundError, InactiveRecipientError, RecipientNotFoundError } from '../../domain/errors';
import { toDeliveryDetailOutput, toDeliveryOutput, toDirectAnnouncementOutput, toGlobalAnnouncementOutput } from '../dto/admin-notification.output';
import type { DeliveryRepository } from '../ports/delivery-repository.port';
import type { RecipientDirectory } from '../ports/recipient-directory.port';
import type { CreateNotification, CreateNotificationInput } from './create-notification.use-case';

/** El tipo de los avisos que se escriben a mano desde el panel. */
const ANNOUNCEMENT_TYPE = 'NOTIFICACION_GENERAL';

interface Announcement {
  titulo: string;
  contenido: string;
  asunto?: string | null;
}

export class SendGlobalAnnouncement {
  constructor(
    private readonly create: Pick<CreateNotification, 'execute'>,
    private readonly audit: AuditTrail,
    private readonly logoUrl: string | null | undefined
  ) {}

  async execute({ actorId, announcement }: { actorId: string; announcement: Announcement }) {
    const { titulo, contenido, asunto } = announcement;
    const result = await this.create.execute({
      type: ANNOUNCEMENT_TYPE,
      userId: null,
      relatedEntity: null,
      metadata: { titulo, contenido, asunto, logoUrl: this.logoUrl }
    });
    const globalNotificationId = 'globalNotificationId' in result ? result.globalNotificationId : '';
    await this.audit.record('GLOBAL_NOTIFICATION_SENT', {
      actorId,
      details: { titulo },
      entityId: globalNotificationId,
      entityType: 'GlobalNotification',
      entityTable: 'global_notifications'
    });
    return toGlobalAnnouncementOutput({ globalNotificationId, titulo, contenido, asunto });
  }
}

export class SendDirectAnnouncement {
  constructor(
    private readonly recipients: Pick<RecipientDirectory, 'findRecipient'>,
    private readonly create: Pick<CreateNotification, 'execute'>,
    private readonly audit: AuditTrail,
    private readonly logoUrl: string | null | undefined
  ) {}

  async execute({ actorId, announcement }: { actorId: string; announcement: Announcement & { userId: string } }) {
    const { userId, titulo, contenido, asunto } = announcement;
    const recipient = await this.recipients.findRecipient(userId);
    if (!recipient) {
      throw new RecipientNotFoundError();
    }
    if (!recipient.isActive) {
      throw new InactiveRecipientError();
    }
    const result = await this.create.execute({
      type: ANNOUNCEMENT_TYPE,
      userId,
      relatedEntity: null,
      metadata: { titulo, contenido, asunto, logoUrl: this.logoUrl }
    });
    const notificationId = 'notificationId' in result ? result.notificationId : '';
    await this.audit.record('DIRECT_NOTIFICATION_SENT', {
      actorId,
      details: { userId, titulo },
      entityId: notificationId,
      entityType: 'Notification',
      entityTable: 'notifications'
    });
    return toDirectAnnouncementOutput({ notificationId, userId, titulo, contenido, asunto });
  }
}

/** Una notificación pedida por otro sistema (autenticado con X-API-Key). */
export class CreateExternalNotification {
  constructor(
    private readonly create: Pick<CreateNotification, 'execute'>,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({
    request,
    externalService
  }: {
    request: { tipoNotificacion: string; userId?: string | null; relatedEntity?: CreateNotificationInput['relatedEntity']; metadata?: Record<string, unknown> };
    externalService: string | null | undefined;
  }) {
    const { tipoNotificacion, ...rest } = request;
    const result = await this.create.execute({ type: tipoNotificacion, ...rest });
    this.logger.info('Notificación creada por servicio externo', { tipoNotificacion, userId: request.userId, externalService });
    await this.audit.record('NOTIFICATION_CREATED', {
      actorId: null,
      details: { tipoNotificacion, userId: request.userId, externalService },
      entityType: 'Notification',
      entityTable: 'notifications'
    });
    return result;
  }
}

// ── Entregas ──────────────────────────────────────────────────

const DELIVERY = { entityType: 'NotificationDelivery', entityTable: 'notification_deliveries' } as const;

export interface DeliveryListQuery extends PageQuery {
  status?: string | null;
  channel?: string | null;
  userId?: string | null;
  from?: string | Date | null;
  to?: string | Date | null;
}

export class ListDeliveries {
  constructor(
    private readonly deliveries: Pick<DeliveryRepository, 'list'>,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: DeliveryListQuery }) {
    const page = pageRequest(query);
    // status y channel ya vienen validados contra sus valores
    const filters = {
      status: (query.status ?? null) as DeliveryStatus | null,
      channel: (query.channel ?? null) as Channel | null,
      userId: query.userId ?? null,
      from: query.from ?? null,
      to: query.to ?? null
    };
    const { rows, count } = await this.deliveries.list(filters, page);
    await this.audit.record('NOTIFICATION_DELIVERY_LIST_VIEWED', { actorId, details: { totalItems: count }, ...DELIVERY });
    return pageOf(rows.map(toDeliveryOutput), page, count, filters);
  }
}

export class GetDelivery {
  constructor(
    private readonly deliveries: Pick<DeliveryRepository, 'findRecord'>,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, notificationDeliveryId }: { actorId: string; notificationDeliveryId: string }) {
    const record = await this.deliveries.findRecord(notificationDeliveryId);
    if (!record) {
      throw new DeliveryNotFoundError();
    }
    await this.audit.record('NOTIFICATION_DELIVERY_VIEWED', {
      actorId,
      details: { notificationDeliveryId, notificationId: record.notificationId },
      entityId: notificationDeliveryId,
      ...DELIVERY
    });
    return toDeliveryDetailOutput(record);
  }
}
