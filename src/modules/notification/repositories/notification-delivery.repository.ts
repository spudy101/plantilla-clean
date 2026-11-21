// Entregas de una notificación por canal externo (push, email, sms): una fila por canal que aplica.
//
// Ciclo de una fila: pending → sent | failed | skipped. Mientras está pending, next_attempt_at dice
// cuándo toca el próximo intento; el despachador (claimDue) toma las vencidas y, al tomarlas, corre
// next_attempt_at hacia adelante (reserva): si el proceso muere a mitad del envío, la fila vuelve a
// estar vencida al terminar la reserva y otro ciclo la retoma. FOR UPDATE SKIP LOCKED hace que dos
// instancias nunca tomen la misma fila.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import { Prisma } from '../../../shared/infrastructure/database/generated/prisma/client';
import type {
  NotificationChannel,
  NotificationDelivery,
  NotificationDeliveryStatus
} from '../../../shared/infrastructure/database/generated/prisma/client';
import constantsModule from '../../../shared/infrastructure/config';
const { database } = constantsModule;

/** Lo que el despachador necesita de una entrega tomada. */
export type ClaimedDelivery = Pick<NotificationDelivery, 'notificationDeliveryId' | 'notificationId' | 'channel' | 'attempts'>;

const ADMIN_INCLUDE = {
  notification: {
    select: {
      notificationId: true,
      userId: true,
      title: true,
      body: true,
      metadata: true,
      relatedEntityType: true,
      relatedEntityId: true,
      createdAt: true,
      notificationType: {
        select: {
          code: true,
          name: true,
          category: { select: { code: true, name: true, isCritical: true } }
        }
      }
    }
  }
} satisfies Prisma.NotificationDeliveryInclude;

export type DeliveryWithNotification = Prisma.NotificationDeliveryGetPayload<{ include: typeof ADMIN_INCLUDE }>;

class NotificationDeliveryRepository extends PrismaRepository {
  /** Crea una entrega pendiente por canal, todas con el mismo primer intento. */
  async createForNotification(
    notificationId: string,
    channels: readonly NotificationChannel[],
    nextAttemptAt: Date
  ): Promise<NotificationDelivery[]> {
    if (channels.length === 0) {
      return [];
    }
    return (await this.db()).notificationDelivery.createManyAndReturn({
      data: channels.map(channel => ({ notificationId, channel, nextAttemptAt }))
    });
  }

  /**
   * Toma hasta `limit` entregas pendientes y vencidas, y las reserva `leaseMs` (las corre hacia adelante).
   * SQL crudo: Prisma no expresa FOR UPDATE SKIP LOCKED. El `schema` de PrismaPg no cambia el search_path,
   * así que la tabla va calificada. Las fechas van como parámetros de JS (el reloj de la app), igual que
   * las escribe Prisma.
   */
  async claimDue(limit: number, leaseMs: number): Promise<ClaimedDelivery[]> {
    const table = Prisma.raw(`${database.schema ? `"${database.schema}".` : ''}"notification_deliveries"`);
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const rows = await (
      await this.db()
    ).$queryRaw<
      Array<{ notification_delivery_id: string; notification_id: string; channel: NotificationChannel; attempts: number }>
    >`
      UPDATE ${table}
      SET next_attempt_at = ${leaseUntil}, updated_at = ${now}
      WHERE notification_delivery_id IN (
        SELECT notification_delivery_id FROM ${table}
        WHERE status = 'pending' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING notification_delivery_id, notification_id, channel, attempts
    `;
    return rows.map(r => ({
      notificationDeliveryId: r.notification_delivery_id,
      notificationId: r.notification_id,
      channel: r.channel,
      attempts: r.attempts
    }));
  }

  markSent(notificationDeliveryId: string) {
    return this.finish(notificationDeliveryId, 'sent', {
      attempts: { increment: 1 },
      sentAt: new Date(),
      lastError: null,
      lastErrorCode: null
    });
  }

  /** Sin destinatario (sin dispositivos, sin email/teléfono, dirección suprimida): no hay nada que reintentar. */
  markSkipped(notificationDeliveryId: string, reason: string) {
    return this.finish(notificationDeliveryId, 'skipped', { lastError: reason });
  }

  /** Intento fallido: con `nextAttemptAt` queda pendiente para reintentar; sin él, fallida para siempre. */
  recordFailure(notificationDeliveryId: string, { error, errorCode, nextAttemptAt }: NotificationDeliveryRepository.Failure) {
    return this.update(notificationDeliveryId, {
      status: nextAttemptAt ? 'pending' : 'failed',
      attempts: { increment: 1 },
      nextAttemptAt,
      lastError: error,
      lastErrorCode: errorCode
    });
  }

  /** Entregas de una notificación (bandeja admin, tests). */
  async findByNotification(notificationId: string): Promise<NotificationDelivery[]> {
    return (await this.db()).notificationDelivery.findMany({ where: { notificationId }, orderBy: { channel: 'asc' } });
  }

  async findByIdWithNotification(notificationDeliveryId: string): Promise<DeliveryWithNotification | null> {
    return (await this.db()).notificationDelivery.findUnique({ where: { notificationDeliveryId }, include: ADMIN_INCLUDE });
  }

  /** Consulta admin (soporte: "¿le llegó?"). */
  async findAllForAdmin(
    { status = null, channel = null, userId = null, from = null, to = null }: NotificationDeliveryRepository.AdminFilters = {},
    page: PageRequest
  ): Promise<PrismaRepository.Page<DeliveryWithNotification>> {
    const where: Prisma.NotificationDeliveryWhereInput = {};
    if (status) {
      where.status = status;
    }
    if (channel) {
      where.channel = channel;
    }
    if (userId) {
      where.notification = { userId };
    }
    if (from || to) {
      where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    }
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.notificationDelivery.findMany({
        where,
        include: ADMIN_INCLUDE,
        ...this.paginationArgs(page, 'notificationDeliveryId')
      }),
      db.notificationDelivery.count({ where })
    ]);
    return { rows, count };
  }

  private finish(
    notificationDeliveryId: string,
    status: NotificationDeliveryStatus,
    data: Prisma.NotificationDeliveryUpdateManyMutationInput
  ) {
    return this.update(notificationDeliveryId, { ...data, status, nextAttemptAt: null });
  }

  private async update(
    notificationDeliveryId: string,
    data: Prisma.NotificationDeliveryUpdateManyMutationInput
  ): Promise<NotificationDelivery | null> {
    const [row] = await (await this.db()).notificationDelivery.updateManyAndReturn({ where: { notificationDeliveryId }, data });
    return row ?? null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace NotificationDeliveryRepository {
  export interface Failure {
    error: string;
    errorCode: string | null;
    /** null → fallida para siempre (rebote definitivo o intentos agotados). */
    nextAttemptAt: Date | null;
  }

  export interface AdminFilters {
    status?: NotificationDeliveryStatus | null;
    channel?: NotificationChannel | null;
    userId?: string | null;
    from?: string | Date | null;
    to?: string | Date | null;
  }
}

export default new NotificationDeliveryRepository();
