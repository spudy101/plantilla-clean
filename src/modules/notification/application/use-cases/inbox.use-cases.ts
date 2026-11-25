// La bandeja del usuario: la mezclada (personales + globales por fecha), solo personales, solo globales y el
// contador de no leídas. Ver una página la marca como leída (y refresca el contador en segundo plano).
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { UnitOfWork } from '../../../../shared/application/ports/unit-of-work.port';
import { globalItem, mergeByCreatedAt, personalItem, unreadOnPage, type FeedItem } from '../../domain/notification';
import { toFeedOutput, toGlobalListOutput, toPersonalListOutput } from '../dto/notification.output';
import type { GlobalNotificationRepository, PersonalNotificationRepository } from '../ports/inbox-repository.port';
import type { UnreadCountChannel } from '../ports/runtime.port';
import type { UnreadCounter } from './unread-counter';

const { errorMessage } = errorMessageModule;

const PERSONAL = { entityType: 'Notification', entityTable: 'notifications' } as const;
const GLOBAL = { entityType: 'GlobalNotification', entityTable: 'global_notifications' } as const;

type Personal = Pick<PersonalNotificationRepository, 'listAllByUser' | 'listByUser' | 'markAsRead'>;
type Globals = Pick<GlobalNotificationRepository, 'listAll' | 'readIdsOf' | 'markAsRead'>;

/** Todas las globales con lo que el usuario ya leyó. */
async function globalsFor(globals: Globals, userId: string) {
  const [rows, readIds] = await Promise.all([globals.listAll(), globals.readIdsOf(userId)]);
  return { items: rows.map(row => globalItem(row, readIds)), readIds };
}

export class ListNotificationFeed {
  constructor(
    private readonly personal: Personal,
    private readonly globals: Globals,
    private readonly unitOfWork: UnitOfWork,
    private readonly unread: Pick<UnreadCounter, 'refreshLater'>,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ userId, query }: { userId: string; query: PageQuery<'createdAt'> }) {
    const page = pageRequest(query);
    const [personalRows, { items: globalItems, readIds }] = await Promise.all([
      this.personal.listAllByUser(userId),
      globalsFor(this.globals, userId)
    ]);

    const mixed = mergeByCreatedAt(personalRows.map(personalItem), globalItems, page.order);
    const pageItems = mixed.slice(page.offset, page.offset + page.limit);
    await this.markPageAsRead(userId, pageItems, readIds);

    await this.audit.record('NOTIFICATION_LIST_VIEWED', {
      actorId: userId,
      details: { totalItems: mixed.length, page: page.page },
      ...PERSONAL
    });
    return toFeedOutput(pageItems, readIds, page, mixed.length);
  }

  /** Lo no leído de la página queda leído. Si falla, se registra: la bandeja se muestra igual. */
  private async markPageAsRead(userId: string, items: FeedItem[], readIds: string[]) {
    try {
      const unread = unreadOnPage(items, readIds);
      await this.unitOfWork.run(async () => {
        // En secuencia: comparten la transacción (una conexión)
        if (unread.personal.length > 0) {
          await this.personal.markAsRead(unread.personal);
        }
        if (unread.global.length > 0) {
          await this.globals.markAsRead(unread.global, userId);
        }
      });
      if (unread.personal.length > 0 || unread.global.length > 0) {
        this.unread.refreshLater(userId);
      }
    } catch (error) {
      this.logger.error('Error marcando notificaciones de página como leídas', { error: errorMessage(error), userId });
    }
  }
}

export class ListPersonalNotifications {
  constructor(
    private readonly personal: Personal,
    private readonly unread: Pick<UnreadCounter, 'refreshLater'>,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, query }: { userId: string; query: PageQuery<'createdAt'> & { search?: string | null } }) {
    const page = pageRequest(query);
    const { rows, count } = await this.personal.listByUser(userId, page, query.search || null);

    const unreadIds = rows.filter(n => !n.isRead).map(n => n.notificationId);
    if (unreadIds.length > 0) {
      await this.personal.markAsRead(unreadIds);
      this.unread.refreshLater(userId);
    }

    await this.audit.record('NOTIFICATION_PERSONAL_LIST_VIEWED', {
      actorId: userId,
      details: { totalItems: count, page: page.page },
      ...PERSONAL
    });
    return toPersonalListOutput(rows, page, count);
  }
}

export class ListGlobalNotifications {
  constructor(
    private readonly globals: Globals,
    private readonly unread: Pick<UnreadCounter, 'refreshLater'>,
    private readonly audit: AuditTrail
  ) {}

  async execute({ userId, query }: { userId: string; query: Omit<PageQuery, 'sortBy' | 'order'> }) {
    // Orden fijo: de la más reciente a la más antigua.
    const page = pageRequest({ ...query, sortBy: 'createdAt', order: 'DESC' });
    const { items, readIds } = await globalsFor(this.globals, userId);
    const pageItems = items.slice(page.offset, page.offset + page.limit);

    const unreadIds = pageItems.filter(item => !item.isRead).map(item => item.notification.globalNotificationId);
    if (unreadIds.length > 0) {
      await this.globals.markAsRead(unreadIds, userId);
      this.unread.refreshLater(userId);
    }

    await this.audit.record('NOTIFICATION_GLOBAL_LIST_VIEWED', {
      actorId: userId,
      details: { totalItems: items.length, page: page.page },
      ...GLOBAL
    });
    return toGlobalListOutput(pageItems, readIds, page, items.length);
  }
}

export class GetUnreadCount {
  constructor(
    private readonly counter: Pick<UnreadCounter, 'compute'>,
    private readonly channel: Pick<UnreadCountChannel, 'publish'>,
    private readonly audit: AuditTrail
  ) {}

  async execute(userId: string): Promise<number> {
    const count = await this.counter.compute(userId);
    this.channel.publish({ userId, count });
    await this.audit.record('NOTIFICATION_UNREAD_COUNT_VIEWED', { actorId: userId, details: { count }, ...PERSONAL });
    return count;
  }
}
