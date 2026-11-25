// Puerto de persistencia de las entregas por canal externo. Lo implementa
// infrastructure/persistence/prisma-delivery.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ClaimedDelivery, DeliveryRecord, DeliveryStatus } from '../../domain/delivery';
import type { Channel } from '../../domain/notification-type';
import type { Page } from './notification-catalog-repository.port';

export interface DeliveryFailure {
  error: string;
  errorCode: string | null;
  /** null → fallida para siempre (rebote definitivo o intentos agotados). */
  nextAttemptAt: Date | null;
}

export interface DeliveryFilters {
  status: DeliveryStatus | null;
  channel: Channel | null;
  userId: string | null;
  from: string | Date | null;
  to: string | Date | null;
}

export interface DeliveryRepository {
  /** Una entrega pendiente por canal, todas con el mismo primer intento. */
  createFor(notificationId: string, channels: readonly Channel[], firstAttemptAt: Date): Promise<ClaimedDelivery[]>;
  /**
   * Toma hasta `limit` entregas pendientes y vencidas y las reserva `leaseMs` (corre su próximo intento hacia
   * adelante). Dos instancias nunca toman la misma.
   */
  claimDue(limit: number, leaseMs: number): Promise<ClaimedDelivery[]>;
  markSent(notificationDeliveryId: string): Promise<void>;
  /** Sin destinatario: no hay nada que reintentar. */
  markSkipped(notificationDeliveryId: string, reason: string): Promise<void>;
  /** Con `nextAttemptAt` queda pendiente para reintentar; sin él, fallida para siempre. */
  recordFailure(notificationDeliveryId: string, failure: DeliveryFailure): Promise<void>;
  findRecord(notificationDeliveryId: string): Promise<DeliveryRecord | null>;
  list(filters: DeliveryFilters, page: PageRequest): Promise<Page<DeliveryRecord>>;
}
