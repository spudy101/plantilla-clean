// Adaptador Prisma del puerto EmailSuppressionRepository (suppression list de correo, por email_hash).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { EmailSuppressionRepository } from '../../application/ports/email-suppression-repository.port';
import type { EmailSuppression, HardBounceResult } from '../../domain/email-suppression';
import { NotificationMapper } from './notification.mapper';

export class PrismaEmailSuppressionRepository extends PrismaRepository implements EmailSuppressionRepository {
  async isSuppressed(emailHash: string): Promise<boolean> {
    return (await (await this.db()).emailBounceSuppression.count({ where: { emailHash, status: 'suppressed' } })) > 0;
  }

  registerHardBounce(
    emailHash: string,
    { userId, errorCode, threshold }: { userId: string | null; errorCode: string | null; threshold: number }
  ): Promise<HardBounceResult> {
    return this.atomic(async db => {
      // Crea la fila si no existe; el incremento la bloquea para el resto de la transacción.
      await db.emailBounceSuppression.upsert({ where: { emailHash }, create: { emailHash, userId, bounceCount: 0, status: 'active' }, update: {} });
      const locked = await db.emailBounceSuppression.update({ where: { emailHash }, data: { bounceCount: { increment: 1 } } });

      const alreadySuppressed = locked.status === 'suppressed';
      const { bounceCount } = locked;
      const reachedThreshold = bounceCount >= threshold;
      await db.emailBounceSuppression.update({
        where: { emailHash },
        data: {
          userId: locked.userId || userId,
          lastErrorCode: errorCode,
          lastBounceAt: new Date(),
          status: reachedThreshold ? 'suppressed' : locked.status,
          suppressedAt: reachedThreshold && !alreadySuppressed ? new Date() : locked.suppressedAt
        }
      });
      return { bounceCount, suppressed: reachedThreshold, alreadySuppressed };
    });
  }

  async lift(emailHash: string): Promise<EmailSuppression | null> {
    const [row] = await (await this.db()).emailBounceSuppression.updateManyAndReturn({
      where: { emailHash },
      data: { status: 'active', bounceCount: 0, suppressedAt: null }
    });
    return row ? NotificationMapper.suppressionToDomain(row) : null;
  }
}
