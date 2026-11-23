import emailBounceSuppressionRepo from '../repositories/email-bounce-suppression.repository';
import EncryptionUtil from '../../../shared/infrastructure/security/encryption.util';
import MaskingUtil from '../../../shared/domain/pii/masking.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import auditModule from '../../audit';
const { audit } = auditModule;

// Umbral de rebotes duros para bloquear una dirección de correo. Regla de negocio (no configurable
// por env): a los 3 hard bounces la dirección se suprime.
const HARD_BOUNCE_SUPPRESSION_THRESHOLD = 3;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

const ENTITY = { entityType: 'EmailBounceSuppression', entityTable: 'email_bounce_suppressions' };

class EmailSuppressionService {
  /**
   * Dependencias inyectables (SOLID: D):
   *   new EmailSuppressionService({ emailBounceSuppressionRepo: fake })
   * @param {object} [deps]
   */
  emailBounceSuppressionRepo: typeof emailBounceSuppressionRepo;
  /** Regla de negocio fija, expuesta para el admin */
  readonly threshold: number;

  constructor(deps: EmailSuppressionService.Deps = {}) {
    this.emailBounceSuppressionRepo = deps.emailBounceSuppressionRepo ?? emailBounceSuppressionRepo;
    this.threshold = HARD_BOUNCE_SUPPRESSION_THRESHOLD; // regla de negocio fija, expuesta para el admin
  }

  /** Normaliza un correo (o hash ya calculado) a su email_hash SHA-256. */
  _toHash(emailOrHash: string | null | undefined) {
    if (!emailOrHash) {
      return null;
    }
    // Un hash SHA-256 es hex de 64 chars; si ya viene así (desde el listado admin), se usa tal cual.
    if (SHA256_HEX.test(emailOrHash)) {
      return emailOrHash.toLowerCase();
    }
    return EncryptionUtil.generateHash(emailOrHash.trim().toLowerCase());
  }

  /** ¿La dirección está bloqueada para envíos? */
  isSuppressed(emailOrHash: string) {
    const emailHash = this._toHash(emailOrHash);
    if (!emailHash) {
      return Promise.resolve(false);
    }
    return this.emailBounceSuppressionRepo.isSuppressed(emailHash);
  }

  /**
   * Registra un rebote duro para una dirección. Incrementa el contador y, al alcanzar el umbral,
   * bloquea la dirección. Emite auditoría del rebote y del bloqueo (cuando ocurre).
   * @param {{ email?: string, emailHash?: string, errorCode?: string, userId?: string }} params
   */
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
  }) {
    const hash = this._toHash(emailHash || email);
    if (!hash) {
      return null;
    }

    const result = await this.emailBounceSuppressionRepo.registerHardBounce(hash, {
      userId,
      errorCode,
      threshold: HARD_BOUNCE_SUPPRESSION_THRESHOLD
    });

    const maskedEmail = email ? MaskingUtil.maskEmail(email) : null;

    await audit.record('EMAIL_HARD_BOUNCE_RECORDED', {
      actorId: 'system',
      details: { emailHash: hash, maskedEmail, errorCode, bounceCount: result.bounceCount, threshold: HARD_BOUNCE_SUPPRESSION_THRESHOLD },
      ...ENTITY,
      outcome: 'failure'
    });

    // Solo la transición active → suppressed dispara el evento de bloqueo (no cada rebote posterior).
    if (result.suppressed && !result.alreadySuppressed) {
      logger.warn('[EmailSuppression] Dirección bloqueada por rebotes duros', {
        emailHash: hash,
        bounceCount: result.bounceCount
      });
      await audit.record('EMAIL_ADDRESS_SUPPRESSED', {
        actorId: 'system',
        details: { emailHash: hash, maskedEmail, bounceCount: result.bounceCount, threshold: HARD_BOUNCE_SUPPRESSION_THRESHOLD },
        ...ENTITY,
        outcome: 'failure'
      });
    }

    return result;
  }

  /**
   * Levanta la supresión de una dirección (des-bloqueo manual por un admin).
   * @param {{ email?: string, emailHash?: string, adminUserId: string }} params
   */
  async lift({ email = null, emailHash = null, adminUserId }: { email?: string | null; emailHash?: string | null; adminUserId: string }) {
    const hash = this._toHash(emailHash || email);
    const record = hash ? await this.emailBounceSuppressionRepo.lift(hash) : null;
    await audit.record('EMAIL_SUPPRESSION_LIFTED', {
      actorId: adminUserId,
      details: { emailHash: hash, maskedEmail: email ? MaskingUtil.maskEmail(email) : null, found: record !== null },
      ...ENTITY
    });
    return record;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace EmailSuppressionService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    emailBounceSuppressionRepo?: typeof emailBounceSuppressionRepo;
  }
}

export default Object.assign(new EmailSuppressionService(), { EmailSuppressionService });
