// La suppression list de correo: si una dirección está bloqueada y el registro de cada rebote duro (con el
// bloqueo al llegar al umbral). Cada rebote y cada bloqueo nuevo quedan en la auditoría.
import MaskingUtil from '../../../../shared/domain/pii/masking.util';
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import {
  HARD_BOUNCE_SUPPRESSION_THRESHOLD,
  isEmailHash,
  isNewSuppression,
  normalizeEmail,
  type HardBounceResult
} from '../../domain/email-suppression';
import type { EmailSuppressionRepository } from '../ports/email-suppression-repository.port';
import type { ContactCipher } from '../ports/runtime.port';

export const SUPPRESSION_ENTITY = { entityType: 'EmailBounceSuppression', entityTable: 'email_bounce_suppressions' } as const;

export class EmailSuppressionList {
  /** La regla de negocio fija, expuesta para quien la necesite mostrar. */
  readonly threshold = HARD_BOUNCE_SUPPRESSION_THRESHOLD;

  constructor(
    private readonly suppressions: EmailSuppressionRepository,
    private readonly cipher: Pick<ContactCipher, 'hash'>,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  /** El email_hash de un correo (o el hash tal cual, si ya lo es). */
  hashOf(emailOrHash: string | null | undefined): string | null {
    if (!emailOrHash) {
      return null;
    }
    return isEmailHash(emailOrHash) ? emailOrHash.toLowerCase() : this.cipher.hash(normalizeEmail(emailOrHash));
  }

  /** ¿La dirección está bloqueada para envíos? */
  isSuppressed(emailOrHash: string): Promise<boolean> {
    const emailHash = this.hashOf(emailOrHash);
    return emailHash ? this.suppressions.isSuppressed(emailHash) : Promise.resolve(false);
  }

  /** Registra un rebote duro de la dirección. null si no hay dirección. */
  async registerHardBounce({
    email = null,
    emailHash = null,
    errorCode = null,
    userId = null
  }: {
    email?: string | null;
    emailHash?: string | null;
    errorCode?: string | null;
    userId?: string | null;
  }): Promise<HardBounceResult | null> {
    const hash = this.hashOf(emailHash || email);
    if (!hash) {
      return null;
    }
    const threshold = HARD_BOUNCE_SUPPRESSION_THRESHOLD;
    const result = await this.suppressions.registerHardBounce(hash, { userId, errorCode, threshold });
    const maskedEmail = email ? MaskingUtil.maskEmail(email) : null;

    await this.audit.record('EMAIL_HARD_BOUNCE_RECORDED', {
      actorId: 'system',
      details: { emailHash: hash, maskedEmail, errorCode, bounceCount: result.bounceCount, threshold },
      ...SUPPRESSION_ENTITY,
      outcome: 'failure'
    });

    if (isNewSuppression(result)) {
      this.logger.warn('[EmailSuppression] Dirección bloqueada por rebotes duros', { emailHash: hash, bounceCount: result.bounceCount });
      await this.audit.record('EMAIL_ADDRESS_SUPPRESSED', {
        actorId: 'system',
        details: { emailHash: hash, maskedEmail, bounceCount: result.bounceCount, threshold },
        ...SUPPRESSION_ENTITY,
        outcome: 'failure'
      });
    }
    return result;
  }
}
