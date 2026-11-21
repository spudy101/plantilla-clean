// modules/schemas/notification/repositories/sms-delivery-attempt.repository.ts
//
// Bitácora de envíos SMS (por phone_hash, sin el número en claro).
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { SmsDeliveryAttempt } from '../../../shared/database/generated/prisma/client';

class SmsDeliveryAttemptRepository extends PrismaRepository {
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
    return (await this.db()).smsDeliveryAttempt.count({
      where: { status: 'failed', createdAt: from ? { gte: from, lte: to } : { lte: to } }
    });
  }

  /** null si el intento no existe. */
  async markSent(smsAttemptId: string, { providerMessageId = null }: { providerMessageId?: string | null } = {}): Promise<SmsDeliveryAttempt | null> {
    const [row] = await (await this.db()).smsDeliveryAttempt.updateManyAndReturn({
      where: { smsDeliveryAttemptId: smsAttemptId },
      data: { status: 'sent', providerMessageId, sentAt: new Date() }
    });
    return row ?? null;
  }

  /** null si el intento no existe. Sin `retryCount` conserva el que tenía. */
  async markFailed(smsAttemptId: string, { lastError, retryCount }: { lastError?: string | null; retryCount?: number } = {}): Promise<SmsDeliveryAttempt | null> {
    const [row] = await (await this.db()).smsDeliveryAttempt.updateManyAndReturn({
      where: { smsDeliveryAttemptId: smsAttemptId },
      data: { status: 'failed', lastError: lastError || null, ...(retryCount !== undefined ? { retryCount } : {}) }
    });
    return row ?? null;
  }
}

export default new SmsDeliveryAttemptRepository();
