// Bitácora de envíos SMS (por phone_hash, sin el número en claro). La escribe el proveedor SMS; integration
// cuenta sus fallos durante una caída.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { SmsDeliveryAttempt } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { SmsAttemptLog } from '../../application/ports/channel-gateways.port';

export class PrismaSmsAttemptRepository extends PrismaRepository implements SmsAttemptLog {
  async createAttempt({
    userId,
    phoneHash,
    provider = 'aws_sms',
    purpose
  }: {
    userId?: string | null;
    phoneHash: string;
    provider?: string;
    purpose: string;
  }): Promise<SmsDeliveryAttempt> {
    return (await this.db()).smsDeliveryAttempt.create({
      data: { userId: userId || null, phoneHash, provider, purpose, status: 'pending', retryCount: 0 }
    });
  }

  /** Intentos fallidos en una ventana (impacto de un fallback del proveedor SMS). Sin `from`, todo lo anterior a `to`. */
  async countFailedBetween(from: Date | null, to: Date): Promise<number> {
    return (await this.db()).smsDeliveryAttempt.count({ where: { status: 'failed', createdAt: from ? { gte: from, lte: to } : { lte: to } } });
  }

  async markSent(smsAttemptId: string, { providerMessageId = null }: { providerMessageId?: string | null } = {}): Promise<void> {
    await (await this.db()).smsDeliveryAttempt.updateMany({
      where: { smsDeliveryAttemptId: smsAttemptId },
      data: { status: 'sent', providerMessageId, sentAt: new Date() }
    });
  }

  /** Sin `retryCount` conserva el que tenía. */
  async markFailed(smsAttemptId: string, { lastError, retryCount }: { lastError?: string | null; retryCount?: number } = {}): Promise<void> {
    await (await this.db()).smsDeliveryAttempt.updateMany({
      where: { smsDeliveryAttemptId: smsAttemptId },
      data: { status: 'failed', lastError: lastError || null, ...(retryCount !== undefined ? { retryCount } : {}) }
    });
  }
}
