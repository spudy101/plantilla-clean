// Adaptadores Prisma de la bandeja in-app: notificaciones personales y globales (con sus lecturas y el avance
// de su envío masivo). origin_session_id lo completa la extensión de Prisma al crear.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type {
  BroadcastProgress,
  GlobalNotificationRepository,
  PersonalNotificationRepository
} from '../../application/ports/inbox-repository.port';
import type { Page } from '../../application/ports/notification-catalog-repository.port';
import type {
  GlobalNotification,
  NewGlobalNotification,
  NewPersonalNotification,
  PersonalNotification
} from '../../domain/notification';
import { NotificationMapper } from './notification.mapper';

const WITH_TYPE = { notificationType: true } as const;
const WITH_TYPE_AND_CATEGORY = { notificationType: { include: { category: true } } } as const;

const daysAgo = (days: number) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
};

export class PrismaPersonalNotificationRepository extends PrismaRepository implements PersonalNotificationRepository {
  async create(notification: NewPersonalNotification): Promise<PersonalNotification> {
    const row = await (await this.db()).notification.create({
      data: { ...notification, metadata: notification.metadata as Prisma.InputJsonValue }
    });
    return NotificationMapper.notificationToDomain(row);
  }

  async findWithType(notificationId: string): Promise<PersonalNotification | null> {
    const row = await (await this.db()).notification.findUnique({ where: { notificationId }, include: WITH_TYPE_AND_CATEGORY });
    return row ? NotificationMapper.notificationToDomain(row) : null;
  }

  async listByUser(userId: string, pagination: PageRequest, search: string | null): Promise<Page<PersonalNotification>> {
    const where = { userId, ...this.searchWhere(search, search ? ['title', 'body'] : []) } as Prisma.NotificationWhereInput;
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.notification.findMany({ where, include: WITH_TYPE, ...this.paginationArgs(pagination, 'notificationId') }),
      db.notification.count({ where })
    ]);
    return { rows: rows.map(NotificationMapper.notificationToDomain), count };
  }

  async listAllByUser(userId: string): Promise<PersonalNotification[]> {
    const rows = await (await this.db()).notification.findMany({ where: { userId }, include: WITH_TYPE, orderBy: { createdAt: 'desc' } });
    return rows.map(NotificationMapper.notificationToDomain);
  }

  async countUnreadByUser(userId: string): Promise<number> {
    return (await this.db()).notification.count({ where: { userId, isRead: false } });
  }

  async markAsRead(notificationIds: readonly string[]): Promise<number> {
    const { count } = await (await this.db()).notification.updateMany({
      where: { notificationId: { in: [...notificationIds] }, isRead: false },
      data: { isRead: true, readAt: new Date() }
    });
    return count;
  }

  async deleteReadOlderThan(days: number): Promise<number> {
    return (await (await this.db()).notification.deleteMany({ where: { isRead: true, readAt: { lt: daysAgo(days) } } })).count;
  }
}

export class PrismaGlobalNotificationRepository extends PrismaRepository implements GlobalNotificationRepository {
  async create({ reservedUntil, metadata, ...notification }: NewGlobalNotification): Promise<GlobalNotification> {
    const row = await (await this.db()).globalNotification.create({
      data: {
        ...notification,
        metadata: metadata as Prisma.InputJsonValue,
        ...(reservedUntil ? { status: 'processing', lockedUntil: reservedUntil } : {})
      }
    });
    return NotificationMapper.globalToDomain(row);
  }

  async listAll(): Promise<GlobalNotification[]> {
    const rows = await (await this.db()).globalNotification.findMany({ include: WITH_TYPE, orderBy: { createdAt: 'desc' } });
    return rows.map(NotificationMapper.globalToDomain);
  }

  async countUnreadByUser(userId: string): Promise<number> {
    return (await this.db()).globalNotification.count({ where: { globalNotificationReads: { none: { userId } } } });
  }

  async readIdsOf(userId: string): Promise<string[]> {
    const rows = await (await this.db()).globalNotificationRead.findMany({ where: { userId }, select: { globalNotificationId: true } });
    return rows.map(r => r.globalNotificationId);
  }

  async markAsRead(globalNotificationIds: readonly string[], userId: string): Promise<number> {
    if (globalNotificationIds.length === 0) {
      return 0;
    }
    const readAt = new Date();
    // Una segunda lectura no pisa la primera (ni su origin_session_id)
    const { count } = await (await this.db()).globalNotificationRead.createMany({
      data: globalNotificationIds.map(globalNotificationId => ({ globalNotificationId, userId, readAt })),
      skipDuplicates: true
    });
    return count;
  }

  /**
   * Dos instancias no toman el mismo: el UPDATE vuelve a evaluar la condición sobre la fila ya bloqueada. Las
   * fechas van desde JS (como las escribe Prisma), no con now() de la base.
   */
  async claimDue(leaseMs: number): Promise<GlobalNotification[]> {
    const now = new Date();
    const db = await this.db();
    const claimed = await db.globalNotification.updateManyAndReturn({
      where: { status: { in: ['pending', 'processing'] }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { status: 'processing', lockedUntil: new Date(now.getTime() + leaseMs) },
      select: { globalNotificationId: true }
    });
    if (claimed.length === 0) {
      return [];
    }
    const rows = await db.globalNotification.findMany({
      where: { globalNotificationId: { in: claimed.map(c => c.globalNotificationId) } },
      include: WITH_TYPE_AND_CATEGORY,
      orderBy: { createdAt: 'asc' }
    });
    return rows.map(NotificationMapper.globalToDomain);
  }

  async recordProgress(globalNotificationId: string, { cursorUserId, pushSent, emailSent, leaseMs }: BroadcastProgress): Promise<void> {
    await this.update(globalNotificationId, {
      cursorUserId,
      pushSentCount: { increment: pushSent },
      emailSentCount: { increment: emailSent },
      lockedUntil: new Date(Date.now() + leaseMs)
    });
  }

  async finish(globalNotificationId: string, status: 'completed' | 'failed'): Promise<void> {
    await this.update(globalNotificationId, { status, lockedUntil: null });
  }

  private async update(globalNotificationId: string, data: Prisma.GlobalNotificationUncheckedUpdateManyInput): Promise<void> {
    await (await this.db()).globalNotification.updateMany({ where: { globalNotificationId }, data });
  }
}
