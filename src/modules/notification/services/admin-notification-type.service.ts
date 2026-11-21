import notificationTypeRepository from '../repositories/notification-type.repository';
import notificationCategoryRepository from '../repositories/notification-category.repository';
import iamModule from '../../iam';
const { userRepository } = iamModule;
import NotificationUtil from './notification-creation.service';
import AppError from '../../../shared/http/app-error.util';
import constantsModule from '../../../shared/constants';
const { notifications } = constantsModule;
import adminNotificationTypeDtoModule from '../responses/admin-notification-type.response';
import auditModule from '../../audit';
import { pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { TypeListQuery } from '../requests/notification.request';
const { audit } = auditModule;
const {
  ListNotificationTypesResponseDTO,
  UpdateNotificationTypeResponseDTO,
  CreateGlobalNotificationResponseDTO,
  CreateDirectNotificationResponseDTO
} = adminNotificationTypeDtoModule;

class NotificationTypeService {
  notificationTypeRepository: typeof notificationTypeRepository;
  notificationCategoryRepository: typeof notificationCategoryRepository;
  userRepository: typeof userRepository;
  NotificationUtil: typeof NotificationUtil;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new NotificationTypeService({ notificationTypeRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: NotificationTypeService.Deps = {}) {
    this.notificationTypeRepository = deps.notificationTypeRepository ?? notificationTypeRepository;
    this.notificationCategoryRepository = deps.notificationCategoryRepository ?? notificationCategoryRepository;
    this.userRepository = deps.userRepository ?? userRepository;
    this.NotificationUtil = deps.NotificationUtil ?? NotificationUtil;
  }

  async list(query: TypeListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = { isActive: query.isActive ?? undefined, notificationCategoryId: query.notificationCategoryId ?? undefined };

    const { rows, count } = await this.notificationTypeRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('NOTIFICATION_TYPE_LIST_VIEWED', {
      actorId: adminUserId,
      details: {
        totalItems: count,
        page: page.page
      },
      entityType: 'NotificationType',
      entityTable: 'notification_types'
    });

    return ListNotificationTypesResponseDTO(rows, pageMetadata(page, count, { search: query.search, ...filters }));
  }

  async update(notificationTypeId: string, data: Record<string, unknown>, adminUserId: string) {
    const nt = await this.notificationTypeRepository.findById(notificationTypeId);
    if (!nt) {
      throw AppError.notFound('Tipo de notificación no encontrado');
    }

    // Si se reasigna la categoría, validar que exista (además del FK) para dar un error claro.
    if (typeof data.notificationCategoryId === 'string' && data.notificationCategoryId) {
      const category = await this.notificationCategoryRepository.findById(data.notificationCategoryId);
      if (!category) {
        throw AppError.badRequest('La categoría indicada no existe');
      }
    }

    // Los templates no se incluyen: son read-only vía API. Canales y criticidad viven en la categoría.
    const EDITABLE = ['name', 'description', 'notificationCategoryId'] as const;
    const updateData: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return UpdateNotificationTypeResponseDTO(nt);
    }

    const updated = await this.notificationTypeRepository.update(notificationTypeId, updateData);
    if (!updated) {
      throw AppError.notFound('Tipo de notificación no encontrado');
    }

    await audit.record('NOTIFICATION_TYPE_UPDATED', {
      actorId: adminUserId,
      details: {
        code: updated.code,
        updatedFields: Object.keys(updateData)
      },
      entityId: notificationTypeId,
      entityType: 'NotificationType',
      entityTable: 'notification_types'
    });

    return UpdateNotificationTypeResponseDTO(updated);
  }

  async createGlobalNotification(data: { titulo: string; contenido: string; asunto?: string | null }, adminUserId: string) {
    const { titulo, contenido, asunto } = data;

    const result = await this.NotificationUtil.crearNotificacion({
      tipoNotificacion: 'NOTIFICACION_GENERAL',
      userId: null,
      relatedEntity: null,
      metadata: { titulo, contenido, asunto, logoUrl: notifications.ses.logoUrl }
    });
    // userId null → la creación devuelve la notificación global
    const globalNotificationId = 'globalNotificationId' in result ? result.globalNotificationId : '';

    await audit.record('GLOBAL_NOTIFICATION_SENT', {
      actorId: adminUserId,
      details: { titulo },
      entityId: globalNotificationId,
      entityType: 'GlobalNotification',
      entityTable: 'global_notifications'
    });

    return CreateGlobalNotificationResponseDTO({
      globalNotificationId,
      titulo,
      contenido,
      asunto
    });
  }

  async createDirectNotification(data: { userId: string; titulo: string; contenido: string; asunto?: string | null }, adminUserId: string) {
    const { userId, titulo, contenido, asunto } = data;

    const user = await this.userRepository.findByUserId(userId, 'minimal');
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }
    if (!user.isActive) {
      throw AppError.badRequest('No se puede notificar a un usuario inactivo');
    }

    const result = await this.NotificationUtil.crearNotificacion({
      tipoNotificacion: 'NOTIFICACION_GENERAL',
      userId,
      relatedEntity: null,
      metadata: { titulo, contenido, asunto, logoUrl: notifications.ses.logoUrl }
    });
    const notificationId = 'notificationId' in result ? result.notificationId : '';

    await audit.record('DIRECT_NOTIFICATION_SENT', {
      actorId: adminUserId,
      details: { userId, titulo },
      entityId: notificationId,
      entityType: 'Notification',
      entityTable: 'notifications'
    });

    return CreateDirectNotificationResponseDTO({
      notificationId,
      userId,
      titulo,
      contenido,
      asunto
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationTypeService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    notificationTypeRepository?: typeof notificationTypeRepository;
    notificationCategoryRepository?: typeof notificationCategoryRepository;
    userRepository?: typeof userRepository;
    NotificationUtil?: typeof NotificationUtil;
  }
}

export default Object.assign(new NotificationTypeService(), { NotificationTypeService });
