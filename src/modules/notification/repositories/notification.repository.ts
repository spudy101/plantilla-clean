// Bandeja in-app del usuario (notificaciones personales). El envío por canal externo vive en
// notification-delivery.repository.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { Notification } from '../../../shared/infrastructure/database/generated/prisma/client';

const WITH_TYPE = { notificationType: true } satisfies Prisma.NotificationInclude;
const WITH_TYPE_AND_CATEGORY = { notificationType: { include: { category: true } } } satisfies Prisma.NotificationInclude;


export type NotificationWithTypeAndCategory = Prisma.NotificationGetPayload<{ include: typeof WITH_TYPE_AND_CATEGORY }>;

class NotificationRepository extends PrismaRepository {
  async create(data: Prisma.NotificationUncheckedCreateInput): Promise<Notification> {
    return (await this.db()).notification.create({ data });
  }

  async findById(notificationId: string): Promise<Notification | null> {
    return (await this.db()).notification.findUnique({ where: { notificationId } });
  }

  /** Con su tipo y la categoría del tipo (lo que necesita el envío por canal). */
  async findByIdWithType(notificationId: string): Promise<NotificationWithTypeAndCategory | null> {
    return (await this.db()).notification.findUnique({ where: { notificationId }, include: WITH_TYPE_AND_CATEGORY });
  }

  /** Notificaciones de un usuario, paginadas y con su tipo; búsqueda opcional sin mayúsculas. */
  async findByUserPaginated(
    userId: string,
    pagination: PageRequest,
    { searchTerm = null, searchFields = [] }: { searchTerm?: string | null; searchFields?: string[] } = {}
  ) {
    const where = { userId, ...this.searchWhere(searchTerm, searchFields) } as Prisma.NotificationWhereInput;
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.notification.findMany({ where, include: WITH_TYPE, ...this.paginationArgs(pagination, 'notificationId') }),
      db.notification.count({ where })
    ]);
    return { rows, count };
  }

  /** Todas las de un usuario, más recientes primero, con su tipo (feed unificado). */
  async findAllByUser(userId: string) {
    return (await this.db()).notification.findMany({ where: { userId }, include: WITH_TYPE, orderBy: { createdAt: 'desc' } });
  }

  async countUnreadByUser(userId: string): Promise<number> {
    return (await this.db()).notification.count({ where: { userId, isRead: false } });
  }

  /** Marca como leídas (solo las que siguen sin leer) las notificaciones indicadas; devuelve cuántas. */
  async markAsReadByIds(notificationIds: string[]): Promise<number> {
    const { count } = await (
      await this.db()
    ).notification.updateMany({
      where: { notificationId: { in: notificationIds }, isRead: false },
      data: { isRead: true, readAt: new Date() }
    });
    return count;
  }

  /** Elimina notificaciones ya leídas más viejas que `daysOld` días (sus entregas se van en cascada); devuelve cuántas. */
  async deleteOldRead(daysOld = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    return (await (await this.db()).notification.deleteMany({ where: { isRead: true, readAt: { lt: cutoff } } })).count;
  }
}

export default new NotificationRepository();
