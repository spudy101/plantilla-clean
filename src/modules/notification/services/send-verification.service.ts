import type { VerificationCodeType } from '../../../shared/infrastructure/database/generated/prisma/client';
import verificationCodeRepository from '../repositories/verification-code.repository';
import NotificationUtil from './notification-creation.service';
import SmsService from './sms.service';
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/infrastructure/config';
const { notifications, MOCKS } = constantsModule;
import crypto from 'node:crypto';
import sendVerificationDtoModule from '../responses/send-verification.response';
const { SendVerificationResponseDTO, VerifyCodeResponseDTO } = sendVerificationDtoModule;
import auditModule from '../../audit';
const { audit } = auditModule;

// [RF-AUTH-01] | CA-02 | 🔄 MODIFICADO: CA-02 especifica
// TTL 24h. Implementado en 15 min por criterio de
// seguridad (OTP numérico en flujo activo).
// Pendiente: actualizar SRS v12.1.
const VERIFICATION_EXPIRATION_MINUTES = 15;
const MAX_VERIFICATION_ATTEMPTS = 5;
const VERIFICATION_CODE_MIN = 100000;
const VERIFICATION_CODE_MAX = 999999;
const MASKED_CODE_VISIBLE_DIGITS = 2;

class SendVerificationService {
  verificationCodeRepository: typeof verificationCodeRepository;
  NotificationUtil: typeof NotificationUtil;
  SmsService: typeof SmsService;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new SendVerificationService({ verificationCodeRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: SendVerificationService.Deps = {}) {
    this.verificationCodeRepository = deps.verificationCodeRepository ?? verificationCodeRepository;
    this.NotificationUtil = deps.NotificationUtil ?? NotificationUtil;
    this.SmsService = deps.SmsService ?? SmsService;
  }

  // ============================================================
  // ENVIAR CÓDIGO
  // ============================================================

  async sendVerificationCode(data: { type: SendVerificationService.ContactType; contact: string; phonePrefixId?: string | null }) {
    const { type, contact, phonePrefixId } = data;

    const waitSeconds = await this.verificationCodeRepository.secondsUntilNewCode(type, contact);
    if (waitSeconds > 0) {
      throw AppError.tooManyRequests(`Debes esperar ${waitSeconds} segundos antes de solicitar un nuevo código`, null, waitSeconds);
    }

    const code = this._generateCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRATION_MINUTES * 60 * 1000);

    const verificationCode = await this.verificationCodeRepository.create({ type, contactValue: contact, code, expiresAt });

    // Ruta pública — userId = null (no hay sesión activa)
    await audit.record('VERIFICATION_CODE_SENT', {
      actorId: null,
      details: {
        type,
        contact,
        expiresAt
      },
      entityId: verificationCode.verificationCodeId,
      entityType: 'VerificationCode',
      entityTable: 'verification_codes'
    });

    setImmediate(() => {
      this._sendCode(type, contact, phonePrefixId, code).catch(err =>
        // El código no llegó al usuario: integración (SES/SMS) caída → solo el admin lo resuelve.
        logger.warn('Error sending verification code', {
          error: err.message,
          type,
          contact,
          codeId: verificationCode.verificationCodeId
        })
      );
    });

    const truncatedCode = this._getTruncatedCode(type, code);
    return SendVerificationResponseDTO({ verificationCode, truncatedCode });
  }

  // ============================================================
  // VERIFICAR CÓDIGO
  // ============================================================

  async verifyCode(data: { type: SendVerificationService.ContactType; contact: string; code: string }) {
    // attempts es nullable en la columna (default 0)
    const { type, contact, code } = data;

    const verificationCode = await this.verificationCodeRepository.findActiveByContact(type, contact);

    if (!verificationCode) {
      logger.info('Verificación de código sin registro activo', { type, contact });
      throw AppError.notFound('Código de verificación no encontrado o expirado');
    }
    if (verificationCode.verifiedAt) {
      logger.info('Intento de reusar un código ya verificado', { type, contact });
      throw AppError.badRequest('Este código ya fue utilizado');
    }
    const attempts = verificationCode.attempts ?? 0;
    if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
      logger.info('Código bloqueado por exceso de intentos', { type, contact, attempts: verificationCode.attempts });
      throw AppError.forbidden('Excediste el número máximo de intentos. Solicita un nuevo código');
    }

    if (verificationCode.code !== code) {
      await this.verificationCodeRepository.incrementAttempts(verificationCode.verificationCodeId);

      // Evento de seguridad (mismo patrón que LOGIN_FAILED / MFA SMS fallido): se audita el
      // intento fallido con outcome=failure y datos (contact, attempts) que el middleware no captura.
      // Ruta pública → userId = null.
      await audit.record('VERIFICATION_CODE_FAILED', {
        actorId: null,
        details: {
          type,
          contact,
          attempts: attempts + 1
        },
        entityId: verificationCode.verificationCodeId,
        entityType: 'VerificationCode',
        entityTable: 'verification_codes',
        outcome: 'failure'
      });

      const remaining = MAX_VERIFICATION_ATTEMPTS - (attempts + 1);
      throw AppError.badRequest(`Código inválido. Te quedan ${remaining} intento${remaining !== 1 ? 's' : ''}`);
    }

    await this.verificationCodeRepository.markAsVerified(verificationCode.verificationCodeId);

    // Verificación exitosa — ruta pública, userId = null
    await audit.record('VERIFICATION_CODE_VERIFIED', {
      actorId: null,
      details: {
        type,
        contact
      },
      entityId: verificationCode.verificationCodeId,
      entityType: 'VerificationCode',
      entityTable: 'verification_codes'
    });

    return VerifyCodeResponseDTO();
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  _generateCode() {
    if (MOCKS.EXTERNAL_PROVIDERS) {
      return '123456';
    }
    return crypto.randomInt(VERIFICATION_CODE_MIN, VERIFICATION_CODE_MAX).toString();
  }

  /** @private */
  _getTruncatedCode(type: SendVerificationService.ContactType, code: string) {
    if (type === 'phone' || MOCKS.EXTERNAL_PROVIDERS) {
      return `****${code.slice(-MASKED_CODE_VISIBLE_DIGITS)}`;
    }
    return null;
  }

  /** @private */
  async _sendCode(type: SendVerificationService.ContactType, contact: string, phonePrefixId: string | null | undefined, code: string) {
    if (type === 'email') {
      await this.NotificationUtil.crearNotificacionDirecta({
        tipoNotificacion: 'CODIGO_VERIFICACION',
        email: contact,
        metadata: {
          codigo: code,
          minutos: VERIFICATION_EXPIRATION_MINUTES,
          logoUrl: notifications.ses.logoUrl
        }
      });
      logger.info('Verification email sent', { email: contact });
    } else if (type === 'phone') {
      // SMS por AWS SNS. Se arma el E.164 con el prefijo del país (ej: +56) + el número local.
      const phoneNumber = await this.SmsService.resolveE164(contact, phonePrefixId);

      const result = await this.SmsService.enviarSmsOtp({
        phoneNumber,
        message: `Tu código de verificación es ${code}. Vence en ${VERIFICATION_EXPIRATION_MINUTES} minutos.`,
        purpose: 'otp_verification'
      });

      if (!result.success) {
        throw new Error(result.error || 'No se pudo enviar el SMS de verificación');
      }
      logger.info('SMS verification code sent', { phone: contact });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace SendVerificationService {
  export type ContactType = VerificationCodeType;

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    verificationCodeRepository?: typeof verificationCodeRepository;
    NotificationUtil?: typeof NotificationUtil;
    SmsService?: typeof SmsService;
  }
}

export default Object.assign(new SendVerificationService(), { SendVerificationService });
