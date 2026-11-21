import type * as Feed from '../notification-feed.types';
import unitOfWork from '../../../shared/database/unit-of-work';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import notificationRepository from '../repositories/notification.repository';
import globalNotificationRepository from '../repositories/global-notification.repository';
// eslint-disable-next-line max-len -- ruta de require de una sola línea; Prettier no la parte
import globalNotificationReadRepository from '../repositories/global-notification-read.repository';
import notificationCreationService from './notification-creation.service';
import NotificationEmitter from '../utils/notification-emitter.util';
import NotificationCountUtil from '../utils/notification-count.util';
import errorMessageModule from '../../../shared/utils/error-message.util';

const { errorMessage } = errorMessageModule;
import auditModule from '../../audit';
import { pageRequest } from '../../../shared/http/pagination';
import type { GlobalNotificationListQuery, NotificationFeedQuery, PersonalNotificationListQuery } from '../requests/notification.request';
const { audit } = auditModule;


class NotificationService {
  unitOfWork: typeof unitOfWork;
  notificationRepository: typeof notificationRepository;
  globalNotificationRepository: typeof globalNotificationRepository;
  globalNotificationReadRepository: typeof globalNotificationReadRepository;
  notificationCreationService: typeof notificationCreationService;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new NotificationService({ unitOfWork: fake })
   * @param {object} [deps]
   */
  constructor(deps: NotificationService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.notificationRepository = deps.notificationRepository ?? notificationRepository;
    this.globalNotificationRepository = deps.globalNotificationRepository ?? globalNotificationRepository;
    this.globalNotificationReadRepository = deps.globalNotificationReadRepository ?? globalNotificationReadRepository;
    this.notificationCreationService = deps.notificationCreationService ?? notificationCreationService;
  }

  // ── Públicos ───────────────────────────────────────────────────────────────

  async getNotificationsList(userId: string, query: NotificationFeedQuery): Promise<Feed.MixedListResult & { personal: Feed.FeedItem[]; global: Feed.GlobalFeedItem[] }> {
    const paginationParams = pageRequest(query);

    const [personal, { rows: globalTagged, readIds }] = await Promise.all([
      this._getPersonalRaw(userId),
      this._getGlobalRaw(userId)
    ]);

    const mixed = this._mergeAndSort(personal, globalTagged, paginationParams.order);
    const totalItems = mixed.length;

    const paginatedMixed = mixed.slice(paginationParams.offset, paginationParams.offset + paginationParams.limit);

    await this._markPageAsRead(userId, paginatedMixed, readIds);

    await audit.record('NOTIFICATION_LIST_VIEWED', {
      actorId: userId,
      details: { totalItems, page: paginationParams.page },
      entityType: 'Notification',
      entityTable: 'notifications'
    });

    return { personal, global: globalTagged, mixed: paginatedMixed, readIds, totalItems, paginationParams };
  }

  async getPersonalNotifications(userId: string, query: PersonalNotificationListQuery): Promise<Feed.PersonalListResult> {
    const paginationParams = pageRequest(query);
    const searchConfig = query.search ? { searchTerm: query.search, searchFields: ['title', 'body'] } : {};
    const { rows, count } = await this.notificationRepository.findByUserPaginated(userId, paginationParams, searchConfig);

    const unreadIds = rows.filter(n => !n.isRead).map(n => n.notificationId);
    await this._markPersonalAsRead(unreadIds);
    if (unreadIds.length > 0) {
      setImmediate(() => NotificationCountUtil.emitCountUpdate(userId));
    }

    await audit.record('NOTIFICATION_PERSONAL_LIST_VIEWED', {
      actorId: userId,
      details: { totalItems: count, page: paginationParams.page },
      entityType: 'Notification',
      entityTable: 'notifications'
    });

    return { rows, count, paginationParams };
  }

  async getGlobalNotifications(userId: string, query: GlobalNotificationListQuery): Promise<Feed.GlobalListResult> {
    // Orden fijo: el repositorio las trae de la más reciente a la más antigua.
    const paginationParams = pageRequest({ ...query, sortBy: 'createdAt', order: 'DESC' });

    const { rows, readIds } = await this._getGlobalRaw(userId);
    const totalItems = rows.length;

    const paginatedRows = rows.slice(paginationParams.offset, paginationParams.offset + paginationParams.limit);

    const unreadIds = paginatedRows
      .filter(item => !readIds.includes(item.__instance.globalNotificationId))
      .map(item => item.__instance.globalNotificationId);

    if (unreadIds.length > 0) {
      await this.globalNotificationReadRepository.bulkMarkAsRead(unreadIds, userId);
      setImmediate(() => NotificationCountUtil.emitCountUpdate(userId));
    }

    await audit.record('NOTIFICATION_GLOBAL_LIST_VIEWED', {
      actorId: userId,
      details: { totalItems, page: paginationParams.page },
      entityType: 'GlobalNotification',
      entityTable: 'global_notifications'
    });

    return { rows: paginatedRows, readIds, totalItems, paginationParams };
  }

  async getUnreadCount(userId: string) {
    const total = await this.computeUnreadCount(userId);

    NotificationEmitter.emit('count-updated', { userId, count: total });

    await audit.record('NOTIFICATION_UNREAD_COUNT_VIEWED', {
      actorId: userId,
      details: { count: total },
      entityType: 'Notification',
      entityTable: 'notifications'
    });

    return total;
  }

  /**
   * Cálculo puro del contador (sin emitir ni auditar). Lo usa el stream SSE para refrescar cada
   * conexión abierta cuando llega el broadcast de una notificación global ({ global: true }).
   */
  async computeUnreadCount(userId: string) {
    const [personalCount, globalCount] = await Promise.all([
      this.notificationRepository.countUnreadByUser(userId),
      this.globalNotificationRepository.countUnreadByUser(userId)
    ]);
    return personalCount + globalCount;
  }

  async createNotification(data: NotificationService.CreateInput, externalService: string | null | undefined = null) {
    const result = await this.notificationCreationService.crearNotificacion(data);

    logger.info('Notificación creada por servicio externo', {
      tipoNotificacion: data.tipoNotificacion,
      userId: data.userId,
      externalService
    });

    await audit.record('NOTIFICATION_CREATED', {
      actorId: null,
      details: { tipoNotificacion: data.tipoNotificacion, userId: data.userId, externalService },
      entityType: 'Notification',
      entityTable: 'notifications'
    });

    return result;
  }

  async createDirectNotification(data: Parameters<NotificationService['notificationCreationService']['crearNotificacionDirecta']>[0]) {
    const result = await this.notificationCreationService.crearNotificacionDirecta(data);

    await audit.record('NOTIFICATION_DIRECT_CREATED', {
      actorId: null,
      details: { tipoNotificacion: data.tipoNotificacion, email: data.email },
      entityType: 'Notification',
      entityTable: 'notifications'
    });

    return result;
  }

  // ── Privados ───────────────────────────────────────────────────────────────

  async _getPersonalRaw(userId: string) {
    const rows = await this.notificationRepository.findAllByUser(userId);

    return rows.map((n): Feed.FeedItem => ({
      __type: 'personal',
      __instance: n,
      createdAt: n.createdAt,
      isRead: n.isRead
    }));
  }

  async _getGlobalRaw(userId: string) {
    const [rows, readIds] = await Promise.all([
      this.globalNotificationRepository.findActiveNotifications(),
      this.globalNotificationReadRepository.getReadIdsByUser(userId)
    ]);

    const tagged = rows.map((gn): Feed.GlobalFeedItem => ({
      __type: 'global',
      __instance: gn,
      createdAt: gn.createdAt,
      isRead: readIds.includes(gn.globalNotificationId)
    }));

    return { rows: tagged, readIds };
  }

  /** Mezcla personales y globales por fecha de creación (el único orden que admite la bandeja). */
  _mergeAndSort(personal: Feed.FeedItem[], globalTagged: Feed.FeedItem[], order: string): Feed.FeedItem[] {
    const merged = [...personal, ...globalTagged];
    const direction = order === 'DESC' ? -1 : 1;
    return merged.sort((a, b) => direction * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  }

  async _markPageAsRead(userId: string, paginatedMixed: Feed.FeedItem[], readIds: string[]) {
    try {
  const { personalUnread, globalUnread } = await this.unitOfWork.run(async () => {
        const personalUnread = paginatedMixed.flatMap(item =>
          item.__type === 'personal' && !item.isRead ? [item.__instance.notificationId] : []
        );

        const globalUnread = paginatedMixed.flatMap(item =>
          item.__type === 'global' && !readIds.includes(item.__instance.globalNotificationId)
            ? [item.__instance.globalNotificationId]
            : []
        );

        // En secuencia: comparten la transacción interactiva de Prisma (una conexión)
        if (personalUnread.length > 0) {
          await this._markPersonalAsRead(personalUnread);
        }
        if (globalUnread.length > 0) {
          await this.globalNotificationReadRepository.bulkMarkAsRead(globalUnread, userId);
        }
        return { personalUnread, globalUnread };
      });

      if (personalUnread.length > 0 || globalUnread.length > 0) {
        setImmediate(() => NotificationCountUtil.emitCountUpdate(userId));
      }
    } catch (error) {
      // Fallo de escritura en BD que el sistema no esperaba ni supo completar → error.
      logger.error('Error marcando notificaciones de página como leídas', { error: errorMessage(error), userId });
    }
  }

  _markPersonalAsRead(notificationIds: string[]) {
    if (!notificationIds || notificationIds.length === 0) {
      return undefined;
    }
    return this.notificationRepository.markAsReadByIds(notificationIds);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationService {
  export type CreateInput = Parameters<(typeof notificationCreationService)['crearNotificacion']>[0];

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    notificationRepository?: typeof notificationRepository;
    globalNotificationRepository?: typeof globalNotificationRepository;
    globalNotificationReadRepository?: typeof globalNotificationReadRepository;
    notificationCreationService?: typeof notificationCreationService;
  }
}

export default Object.assign(new NotificationService(), { NotificationService });
