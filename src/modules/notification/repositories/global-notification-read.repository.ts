// modules/schemas/notification/repositories/global-notification-read.repository.ts
//
// Lecturas de notificaciones globales (PK compuesta: notificación + usuario). origin_session_id lo
// completa la extensión de Prisma al crear; una segunda marca de lectura no lo pisa (skipDuplicates).
import PrismaRepository from '../../../shared/database/prisma.repository';

class GlobalNotificationReadRepository extends PrismaRepository {
  /** Marca como leídas para el usuario las notificaciones indicadas; las ya leídas no cambian. */
  async bulkMarkAsRead(globalNotificationIds: string[], userId: string): Promise<number> {
    if (globalNotificationIds.length === 0) {
      return 0;
    }
    const readAt = new Date();
    const { count } = await (await this.db()).globalNotificationRead.createMany({
      data: globalNotificationIds.map(globalNotificationId => ({ globalNotificationId, userId, readAt })),
      skipDuplicates: true
    });
    return count;
  }

  /** Ids de las notificaciones globales que el usuario leyó. */
  async getReadIdsByUser(userId: string): Promise<string[]> {
    const rows = await (await this.db()).globalNotificationRead.findMany({ where: { userId }, select: { globalNotificationId: true } });
    return rows.map(r => r.globalNotificationId);
  }
}

export default new GlobalNotificationReadRepository();
