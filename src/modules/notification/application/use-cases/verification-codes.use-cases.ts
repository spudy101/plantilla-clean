// Verificación de un contacto (email o teléfono) con un código OTP: pedirlo (con espera mínima entre pedidos) y
// confirmarlo (con tope de intentos). Son rutas públicas, antes de tener sesión: el actor de la auditoría es null.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import {
  VERIFICATION_EXPIRATION_MINUTES,
  checkCode,
  expirationFrom,
  truncatedCode,
  verificationSmsText,
  wrongCodeError,
  type ContactType
} from '../../domain/verification-code';
import { CodeAlreadyUsedError, CodeRequestTooSoonError, VerificationCodeNotFoundError } from '../../domain/errors';
import { toVerificationSentOutput } from '../dto/admin-notification.output';
import type { VerificationCodeRepository } from '../ports/verification-code-repository.port';
import type { VerificationCodeGenerator } from '../ports/runtime.port';
import type { SendDirectEmail } from './create-notification.use-case';
import type { SmsSender } from './sms-sender';

const ENTITY = { entityType: 'VerificationCode', entityTable: 'verification_codes' } as const;

export interface SendVerificationCodeDeps {
  codes: Pick<VerificationCodeRepository, 'secondsUntilNewCode' | 'create'>;
  generator: VerificationCodeGenerator;
  directEmail: Pick<SendDirectEmail, 'execute'>;
  sms: Pick<SmsSender, 'resolveE164' | 'send'>;
  audit: AuditTrail;
  logger: Logger;
  /** Proveedores simulados (fuera de producción): el código parcial se devuelve también para email. */
  mockProviders: boolean;
  logoUrl: string | null | undefined;
}

export class SendVerificationCode {
  constructor(private readonly deps: SendVerificationCodeDeps) {}

  async execute({ type, contact, phonePrefixId }: { type: ContactType; contact: string; phonePrefixId?: string | null }) {
    const { codes, audit, logger } = this.deps;
    const waitSeconds = await codes.secondsUntilNewCode(type, contact);
    if (waitSeconds > 0) {
      throw new CodeRequestTooSoonError(waitSeconds);
    }

    const code = this.deps.generator.next();
    const expiresAt = expirationFrom();
    const verificationCode = await codes.create({ type, contactValue: contact, code, expiresAt });

    await audit.record('VERIFICATION_CODE_SENT', {
      actorId: null,
      details: { type, contact, expiresAt },
      entityId: verificationCode.verificationCodeId,
      ...ENTITY
    });

    setImmediate(() => {
      this.sendCode(type, contact, phonePrefixId, code).catch((err: Error) =>
        // El código no llegó: la integración (email/SMS) está caída → solo el admin lo resuelve.
        logger.warn('Error sending verification code', {
          error: err.message,
          type,
          contact,
          codeId: verificationCode.verificationCodeId
        })
      );
    });

    return toVerificationSentOutput(verificationCode, truncatedCode(type, code, this.deps.mockProviders));
  }

  private async sendCode(type: ContactType, contact: string, phonePrefixId: string | null | undefined, code: string) {
    const { logger } = this.deps;
    if (type === 'email') {
      await this.deps.directEmail.execute({
        type: 'CODIGO_VERIFICACION',
        email: contact,
        metadata: { codigo: code, minutos: VERIFICATION_EXPIRATION_MINUTES, logoUrl: this.deps.logoUrl }
      });
      logger.info('Verification email sent', { email: contact });
    } else if (type === 'phone') {
      const phoneNumber = await this.deps.sms.resolveE164(contact, phonePrefixId);
      const result = await this.deps.sms.send({ phoneNumber, message: verificationSmsText(code), purpose: 'otp_verification' });
      if (!result.success) {
        throw new Error(result.error || 'No se pudo enviar el SMS de verificación');
      }
      logger.info('SMS verification code sent', { phone: contact });
    }
  }
}

export class VerifyCode {
  constructor(
    private readonly codes: Pick<VerificationCodeRepository, 'findActiveByContact' | 'incrementAttempts' | 'markAsVerified'>,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ type, contact, code }: { type: ContactType; contact: string; code: string }) {
    const verificationCode = await this.codes.findActiveByContact(type, contact);
    if (!verificationCode) {
      this.logger.info('Verificación de código sin registro activo', { type, contact });
      throw new VerificationCodeNotFoundError();
    }

    let matches: boolean;
    try {
      matches = checkCode(verificationCode, code);
    } catch (error) {
      this.logger.info(
        error instanceof CodeAlreadyUsedError ? 'Intento de reusar un código ya verificado' : 'Código bloqueado por exceso de intentos',
        error instanceof CodeAlreadyUsedError ? { type, contact } : { type, contact, attempts: verificationCode.attempts }
      );
      throw error;
    }

    const attempts = verificationCode.attempts ?? 0;
    if (!matches) {
      await this.codes.incrementAttempts(verificationCode.verificationCodeId);
      // Evento de seguridad (como un login fallido): se audita con los datos que el middleware no ve.
      await this.audit.record('VERIFICATION_CODE_FAILED', {
        actorId: null,
        details: { type, contact, attempts: attempts + 1 },
        entityId: verificationCode.verificationCodeId,
        ...ENTITY,
        outcome: 'failure'
      });
      throw wrongCodeError(attempts);
    }

    await this.codes.markAsVerified(verificationCode.verificationCodeId);
    await this.audit.record('VERIFICATION_CODE_VERIFIED', {
      actorId: null,
      details: { type, contact },
      entityId: verificationCode.verificationCodeId,
      ...ENTITY
    });
    return { verified: true as const };
  }
}
