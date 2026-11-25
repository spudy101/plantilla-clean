// Puerto de persistencia de la suppression list de correo (por email_hash). Lo implementa
// infrastructure/persistence/prisma-email-suppression.repository.ts.
import type { EmailSuppression, HardBounceResult } from '../../domain/email-suppression';

export interface EmailSuppressionRepository {
  isSuppressed(emailHash: string): Promise<boolean>;
  /**
   * Suma un rebote duro (crea el registro si no existe) y, al alcanzar `threshold`, marca la dirección como
   * suprimida. Atómico: dos rebotes simultáneos no se pierden.
   */
  registerHardBounce(
    emailHash: string,
    bounce: { userId: string | null; errorCode: string | null; threshold: number }
  ): Promise<HardBounceResult>;
  /** Levanta la supresión (contador a 0). null si no existía. */
  lift(emailHash: string): Promise<EmailSuppression | null>;
}
