// Consulta admin de las entregas de notificaciones (soporte: "¿le llegó el correo a este usuario?").
// Solo lectura: los reintentos son automáticos (notification-delivery.service).
import deliveryRepo from '../repositories/notification-delivery.repository';
import AppError from '../../../shared/http/app-error.util';
import adminNotificationDeliveryDtoModule from '../responses/admin-notification-delivery.response';
const { NotificationDeliveryListDTO, NotificationDeliveryDetailDTO } = adminNotificationDeliveryDtoModule;
import auditModule from '../../audit';
import { pageOf, pageRequest } from '../../../shared/http/pagination';
import type { DeliveryListQuery } from '../requests/notification.request';

type DeliveryFilters = NonNullable<Parameters<(typeof deliveryRepo)['findAllForAdmin']>[0]>;
const { audit } = auditModule;

class AdminNotificationDeliveryService {
  deliveryRepo: typeof deliveryRepo;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones reales:
   *   new AdminNotificationDeliveryService({ deliveryRepo: fake })
   */
  constructor(deps: AdminNotificationDeliveryService.Deps = {}) {
    this.deliveryRepo = deps.deliveryRepo ?? deliveryRepo;
  }

  async list(query: DeliveryListQuery, adminUserId: string) {
    const page = pageRequest(query);
    // status y channel ya vienen validados contra sus valores (DeliveryListQuery)
    const filters = {
      status: (query.status ?? null) as DeliveryFilters['status'],
      channel: (query.channel ?? null) as DeliveryFilters['channel'],
      userId: query.userId ?? null,
      from: query.from ?? null,
      to: query.to ?? null
    };

    const { rows, count } = await this.deliveryRepo.findAllForAdmin(filters, page);

    await audit.record('NOTIFICATION_DELIVERY_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count },
      entityType: 'NotificationDelivery',
      entityTable: 'notification_deliveries'
    });

    return pageOf(rows.map(NotificationDeliveryListDTO), page, count, filters);
  }

  async getById(notificationDeliveryId: string, adminUserId: string) {
    const record = await this.deliveryRepo.findByIdWithNotification(notificationDeliveryId);
    if (!record) {
      throw AppError.notFound('Entrega de notificación no encontrada');
    }

    await audit.record('NOTIFICATION_DELIVERY_VIEWED', {
      actorId: adminUserId,
      details: { notificationDeliveryId, notificationId: record.notificationId },
      entityId: notificationDeliveryId,
      entityType: 'NotificationDelivery',
      entityTable: 'notification_deliveries'
    });

    return NotificationDeliveryDetailDTO(record);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminNotificationDeliveryService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    deliveryRepo?: typeof deliveryRepo;
  }
}

export default Object.assign(new AdminNotificationDeliveryService(), { AdminNotificationDeliveryService });
