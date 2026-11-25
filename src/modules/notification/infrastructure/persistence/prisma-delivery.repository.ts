// Adaptador Prisma del puerto DeliveryRepository.
//
// Mientras una entrega está pending, next_attempt_at dice cuándo toca el próximo intento; al tomarla, el
// despachador corre next_attempt_at hacia adelante (reserva): si el proceso muere a mitad del envío, la fila
// vuelve a estar vencida al terminar la reserva y otro ciclo la retoma. FOR UPDATE SKIP LOCKED hace que dos
// instancias nunca tomen la misma fila.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { NotificationChannel, NotificationDeliveryStatus } from '../../../../shared/infrastructure/database/generated/prisma/client';
import constantsModule from '../../../../shared/infrastructure/config';
import type { DeliveryFailure, DeliveryFilters, DeliveryRepository } from '../../application/ports/delivery-repository.port';
import type { Page } from '../../application/ports/notification-catalog-repository.port';
import type { ClaimedDelivery, DeliveryRecord } from '../../domain/delivery';
import type { Channel } from '../../domain/notification-type';
import { NotificationMapper } from './notification.mapper';

const { database } = constantsModule;

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
      notificationType: { select: { code: true, name: true, category: { select: { code: true, name: true, isCritical: true } } } }
    }
  }
} satisfies Prisma.NotificationDeliveryInclude;

export class PrismaDeliveryRepository extends PrismaRepository implements DeliveryRepository {
  async createFor(notificationId: string, channels: readonly Channel[], firstAttemptAt: Date): Promise<ClaimedDelivery[]> {
    if (channels.length === 0) {
      return [];
    }
    const rows = await (await this.db()).notificationDelivery.createManyAndReturn({
      data: channels.map(channel => ({ notificationId, channel, nextAttemptAt: firstAttemptAt }))
    });
    return rows.map(NotificationMapper.claimedToDomain);
  }

  /**
   * SQL crudo: Prisma no expresa FOR UPDATE SKIP LOCKED. El `schema` de PrismaPg no cambia el search_path, así
   * que la tabla va calificada. Las fechas van como parámetros de JS (el reloj de la app), igual que las escribe
   * Prisma.
   */
  async claimDue(limit: number, leaseMs: number): Promise<ClaimedDelivery[]> {
    const table = Prisma.raw(`${database.schema ? `"${database.schema}".` : ''}"notification_deliveries"`);
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const rows = await (
      await this.db()
    ).$queryRaw<Array<{ notification_delivery_id: string; notification_id: string; channel: NotificationChannel; attempts: number }>>`
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
    return rows.map(r =>
      NotificationMapper.claimedToDomain({
        notificationDeliveryId: r.notification_delivery_id,
        notificationId: r.notification_id,
        channel: r.channel,
        attempts: r.attempts
      })
    );
  }

  async markSent(notificationDeliveryId: string): Promise<void> {
    await this.finish(notificationDeliveryId, 'sent', { attempts: { increment: 1 }, sentAt: new Date(), lastError: null, lastErrorCode: null });
  }

  async markSkipped(notificationDeliveryId: string, reason: string): Promise<void> {
    await this.finish(notificationDeliveryId, 'skipped', { lastError: reason });
  }

  async recordFailure(notificationDeliveryId: string, { error, errorCode, nextAttemptAt }: DeliveryFailure): Promise<void> {
    await this.update(notificationDeliveryId, {
      status: nextAttemptAt ? 'pending' : 'failed',
      attempts: { increment: 1 },
      nextAttemptAt,
      lastError: error,
      lastErrorCode: errorCode
    });
  }

  async findRecord(notificationDeliveryId: string): Promise<DeliveryRecord | null> {
    const row = await (await this.db()).notificationDelivery.findUnique({ where: { notificationDeliveryId }, include: ADMIN_INCLUDE });
    return row ? NotificationMapper.deliveryToDomain(row) : null;
  }

  async list({ status, channel, userId, from, to }: DeliveryFilters, page: PageRequest): Promise<Page<DeliveryRecord>> {
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
      db.notificationDelivery.findMany({ where, include: ADMIN_INCLUDE, ...this.paginationArgs(page, 'notificationDeliveryId') }),
      db.notificationDelivery.count({ where })
    ]);
    return { rows: rows.map(NotificationMapper.deliveryToDomain), count };
  }

  /** Las entregas de una notificación (tests). */
  async findByNotification(notificationId: string) {
    return (await this.db()).notificationDelivery.findMany({ where: { notificationId }, orderBy: { channel: 'asc' } });
  }

  private finish(notificationDeliveryId: string, status: NotificationDeliveryStatus, data: Prisma.NotificationDeliveryUpdateManyMutationInput) {
    return this.update(notificationDeliveryId, { ...data, status, nextAttemptAt: null });
  }

  private async update(notificationDeliveryId: string, data: Prisma.NotificationDeliveryUpdateManyMutationInput): Promise<void> {
    await (await this.db()).notificationDelivery.updateMany({ where: { notificationDeliveryId }, data });
  }
}
