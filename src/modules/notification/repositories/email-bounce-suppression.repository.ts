// modules/schemas/notification/repositories/email-bounce-suppression.repository.ts
//
// Suppression list de correo (por email_hash): rebotes duros por dirección y bloqueo al llegar al umbral.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { EmailBounceSuppression } from '../../../shared/infrastructure/database/generated/prisma/client';

class EmailBounceSuppressionRepository extends PrismaRepository {
  async isSuppressed(emailHash: string): Promise<boolean> {
    return (await (await this.db()).emailBounceSuppression.count({ where: { emailHash, status: 'suppressed' } })) > 0;
  }

  /**
   * Registra un rebote duro: crea el registro o incrementa el contador, y al alcanzar el umbral marca la
   * dirección como 'suppressed'. Atómico (antes, dos rebotes simultáneos podían perder uno).
   */
  registerHardBounce(
    emailHash: string,
    { userId = null, errorCode = null, threshold }: { userId?: string | null; errorCode?: string | null; threshold: number }
  ): Promise<{ bounceCount: number; suppressed: boolean; alreadySuppressed: boolean }> {
    return this.atomic(async db => {
      // Crea la fila si no existe; el incremento en la base la bloquea para el resto de la transacción.
      await db.emailBounceSuppression.upsert({
        where: { emailHash },
        create: { emailHash, userId, bounceCount: 0, status: 'active' },
        update: {}
      });
      const locked = await db.emailBounceSuppression.update({
        where: { emailHash },
        data: { bounceCount: { increment: 1 } }
      });

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

  /** Levanta la supresión (des-bloqueo manual): resetea contador y estado. null si no existía. */
  async lift(emailHash: string): Promise<EmailBounceSuppression | null> {
    const [row] = await (await this.db()).emailBounceSuppression.updateManyAndReturn({
      where: { emailHash },
      data: { status: 'active', bounceCount: 0, suppressedAt: null }
    });
    return row ?? null;
  }
}

export default new EmailBounceSuppressionRepository();
