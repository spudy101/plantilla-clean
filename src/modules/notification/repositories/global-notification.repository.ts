// Notificaciones globales (para todos los clientes): una fila que todos ven in-app y el avance de su
// envío masivo por push/email (estado, cursor por user_id, reserva y contadores).
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { GlobalNotification, Prisma } from '../../../shared/database/generated/prisma/client';

const WITH_TYPE = { notificationType: true } satisfies Prisma.GlobalNotificationInclude;
const WITH_TYPE_AND_CATEGORY = { notificationType: { include: { category: true } } } satisfies Prisma.GlobalNotificationInclude;

export type GlobalNotificationWithType = Prisma.GlobalNotificationGetPayload<{ include: typeof WITH_TYPE_AND_CATEGORY }>;

class GlobalNotificationRepository extends PrismaRepository {
  async create(data: Prisma.GlobalNotificationUncheckedCreateInput): Promise<GlobalNotification> {
    return (await this.db()).globalNotification.create({ data });
  }

  /**
   * Toma los envíos masivos pendientes o a medias cuya reserva venció, y los reserva `leaseMs`. Dos
   * instancias no toman el mismo: el UPDATE vuelve a evaluar la condición sobre la fila ya bloqueada.
   * Las fechas van desde JS (como las escribe Prisma), no con now() de la base.
   */
  async claimDue(leaseMs: number): Promise<GlobalNotificationWithType[]> {
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
    return db.globalNotification.findMany({
      where: { globalNotificationId: { in: claimed.map(c => c.globalNotificationId) } },
      include: WITH_TYPE_AND_CATEGORY,
      orderBy: { createdAt: 'asc' }
    });
  }

  /** Avance de una página: corre el cursor, suma los enviados y renueva la reserva. */
  recordPage(
    globalNotificationId: string,
    { cursorUserId, pushSent, emailSent, leaseMs }: GlobalNotificationRepository.PageProgress
  ) {
    return this.update(globalNotificationId, {
      cursorUserId,
      pushSentCount: { increment: pushSent },
      emailSentCount: { increment: emailSent },
      lockedUntil: new Date(Date.now() + leaseMs)
    });
  }

  /** Termina el envío masivo (completed, o failed si no se puede enviar). */
  finish(globalNotificationId: string, status: 'completed' | 'failed') {
    return this.update(globalNotificationId, { status, lockedUntil: null });
  }

  /** Todas, más recientes primero, con su tipo (la bandeja de todos los usuarios). */
  async findActiveNotifications() {
    return (await this.db()).globalNotification.findMany({ include: WITH_TYPE, orderBy: { createdAt: 'desc' } });
  }

  /** Las que el usuario todavía no leyó, con su tipo. */
  /** Globales que el usuario no leyó (para el contador): un COUNT, sin traer las filas. */
  async countUnreadByUser(userId: string): Promise<number> {
    return (await this.db()).globalNotification.count({ where: { globalNotificationReads: { none: { userId } } } });
  }

  /** null si la fila ya no existe. */
  private async update(
    globalNotificationId: string,
    data: Prisma.GlobalNotificationUncheckedUpdateManyInput
  ): Promise<GlobalNotification | null> {
    const [row] = await (await this.db()).globalNotification.updateManyAndReturn({ where: { globalNotificationId }, data });
    return row ?? null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace GlobalNotificationRepository {
  export interface PageProgress {
    /** Último user_id de la página enviada. */
    cursorUserId: string;
    pushSent: number;
    emailSent: number;
    leaseMs: number;
  }
}

export default new GlobalNotificationRepository();
