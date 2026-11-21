import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
// modules/shared-endpoints/kyc/iam/services/mfa/sms-mfa.service.ts
//
// Segundo factor por SMS: solicitud de código de activación, confirmación y baja.
// Extraído de MFAService (SOLID: S).

import type { RequestAuditContext } from '../../../../shared/application/audit-context';
import crypto from 'node:crypto';
import unitOfWork from '../../../../shared/infrastructure/database/unit-of-work';
import userRepository from '../../repositories/user.repository';
import notificationModule from '../../../notification';
const { verificationCodeRepository, notifier, SmsService } = notificationModule;
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { MOCKS } = constantsModule;
import mfaDtoModule from '../../responses/mfa.response';
const { SMSMFAActivationResponseDTO, SMSActivationRequestResponseDTO } = mfaDtoModule;
import MfaAccount from './mfa-account';
import errorMessageModule from '../../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;
import auditModule from '../../../audit';
const { audit } = auditModule;


const OTP_EXPIRATION_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;
const OTP_CODE_MIN = 100000;
const OTP_CODE_MAX = 999999;
const MASKED_CODE_VISIBLE_DIGITS = 2;
const MS_PER_MINUTE = 60 * 1000;

const ENTITY = { entityType: 'User', entityTable: 'users' };

class SmsMfaService {
  unitOfWork: typeof unitOfWork;
  userRepository: typeof userRepository;
  verificationCodeRepository: typeof verificationCodeRepository;
  notifier: typeof notifier;
  SmsService: typeof SmsService;
  account: InstanceType<typeof MfaAccount>;

  /** @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada MFAService. */
  constructor(deps: SmsMfaService.Deps = {}) {
    this.unitOfWork = deps.unitOfWork ?? unitOfWork;
    this.userRepository = deps.userRepository ?? userRepository;
    this.verificationCodeRepository = deps.verificationCodeRepository ?? verificationCodeRepository;
    this.notifier = deps.notifier ?? notifier;
    this.SmsService = deps.SmsService ?? SmsService;
    this.account = deps.account ?? new MfaAccount(deps);
  }

  async requestSMSActivation(password: string, userId: string, username: string | null) {
    const user = await this.account.getUserWithPhone(userId);
    if (user.smsMfaEnabled) {
      throw AppError.conflict('SMS MFA ya está activado para este usuario');
    }

    await this.account.assertPassword(user, password);

    const phone = this._requirePhone(user);

    const waitSeconds = await this.verificationCodeRepository.secondsUntilNewCode('phone', phone);
    if (waitSeconds > 0) {
      throw AppError.tooManyRequests(`Debes esperar ${waitSeconds} segundos antes de solicitar un nuevo código`, null, waitSeconds);
    }

    const code = this._generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * MS_PER_MINUTE);

    const verificationCode = await this.verificationCodeRepository.create({
      type: 'phone',
      contactValue: phone,
      code,
      expiresAt
    });

    this._sendActivationSms(userId, phone, user.person?.contact?.phonePrimaryPrefixId ?? null, code);

    await audit.record('MFA_SMS_SETUP', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });

    const truncatedCode = `****${code.slice(-MASKED_CODE_VISIBLE_DIGITS)}`;
    return SMSActivationRequestResponseDTO({
      verificationCodeId: verificationCode.verificationCodeId,
      expiresAt,
      truncatedCode
    });
  }

  async confirmSMSActivation(code: string, userId: string, username: string | null, firstName: string | null, auditContext: RequestAuditContext) {
    const user = await this.account.getUserWithPhone(userId);
    if (user.smsMfaEnabled) {
      throw AppError.conflict('SMS MFA ya está activado');
    }

    const phone = this._requirePhone(user);
    const verificationCode = await this._assertValidCode(phone, code);

    await this.unitOfWork.run(async () => {
      await this.verificationCodeRepository.markAsVerified(verificationCode.verificationCodeId);
      // SMS MFA gestionado íntegramente en nuestra BD
      const updates: Prisma.UserUncheckedUpdateManyInput = { smsMfaEnabled: true };
      // Primer MFA activado → queda como método preferido para que el login dispare el SMS
      if (user.preferredMfaMethod === 'none') {
        updates.preferredMfaMethod = 'sms';
      }
      await this.userRepository.update(userId, updates);

      await this.account.recordChange({
        userId,
        changeType: 'sms_mfa_status',
        previousValue: 'disabled',
        newValue: 'enabled',
        changeReason: 'SMS MFA activado por cliente',
        auditContext
      });
    });

    await audit.record('MFA_SMS_ACTIVATED', { actorId: userId, details: { username }, entityId: userId, ...ENTITY });
    this._notify('SMS_MFA_ACTIVADO', userId, firstName);

    return SMSMFAActivationResponseDTO({ userId, username, smsMfaEnabled: true });
  }

  async deactivateSMSMFA(password: string, userId: string, username: string | null, firstName: string | null, auditContext: RequestAuditContext) {
    const user = await this.account.getUserSecure(userId);
    if (!user.smsMfaEnabled) {
      throw AppError.badRequest('SMS MFA no está activado');
    }

    await this.account.assertPassword(user, password);

    await this.unitOfWork.run(async () => {
      // SMS MFA gestionado íntegramente en nuestra BD
      const updates: Prisma.UserUncheckedUpdateManyInput = { smsMfaEnabled: false };
      if (user.preferredMfaMethod === 'sms') {
        updates.preferredMfaMethod = user.totpEnabled ? 'totp' : 'none';
      }
      await this.userRepository.update(userId, updates);

      await this.account.recordChange({
        userId,
        changeType: 'sms_mfa_status',
        previousValue: 'enabled',
        newValue: 'disabled',
        changeReason: 'SMS MFA desactivado por cliente',
        auditContext
      });
    });

    await audit.record('MFA_SMS_DEACTIVATED', {
      actorId: userId,
      details: { username },
      entityId: userId,
      ...ENTITY
    });
    this._notify('SMS_MFA_DESACTIVADO', userId, firstName);

    return SMSMFAActivationResponseDTO({ userId, username, smsMfaEnabled: false });
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /** @private */
  _requirePhone(user: { person?: { contact?: { phonePrimary?: string | null } | null } | null }) {
    const phone = user.person?.contact?.phonePrimary;
    if (!phone) {
      throw AppError.badRequest('Debes registrar un número de teléfono antes de activar SMS MFA');
    }
    return phone;
  }

  /** @private — valida el código vigente del teléfono (existencia, uso, intentos y valor). */
  async _assertValidCode(phone: string, code: string) {
    const verificationCode = await this.verificationCodeRepository.findActiveByContact('phone', phone);
    if (!verificationCode) {
      throw AppError.notFound('Código de verificación no encontrado o expirado');
    }
    if (verificationCode.verifiedAt) {
      throw AppError.badRequest('Este código ya fue utilizado');
    }
    const attempts = verificationCode.attempts ?? 0;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      throw AppError.forbidden('Excediste el número máximo de intentos. Solicita un nuevo código');
    }
    if (verificationCode.code !== code) {
      await this.verificationCodeRepository.incrementAttempts(verificationCode.verificationCodeId);
      const remaining = MAX_OTP_ATTEMPTS - (attempts + 1);
      throw AppError.badRequest(`Código inválido. Te quedan ${remaining} intento${remaining !== 1 ? 's' : ''}`);
    }
    return verificationCode;
  }

  /** @private — SMS por AWS SNS, envío no bloqueante del código de activación. */
  _sendActivationSms(userId: string, phone: string, phonePrefixId: string | null, code: string) {
    setImmediate(async () => {
      try {
        const phoneNumber = await this.SmsService.resolveE164(phone, phonePrefixId);
        const result = await this.SmsService.enviarSmsOtp({
          phoneNumber,
          message: `Tu código de activación de SMS MFA es ${code}. Vence en ${OTP_EXPIRATION_MINUTES} minutos.`,
          userId,
          purpose: 'mfa_setup'
        });
        if (!result.success) {
          logger.warn('SMS MFA activation code no enviado', { userId, error: result.error });
        }
      } catch (err) {
        logger.warn('Error enviando SMS MFA activation code', { userId, error: errorMessage(err) });
      }
    });
  }

  /** @private — notificación fire-and-forget al usuario */
  _notify(type: string, userId: string, firstName: string | null) {
    setImmediate(() => {
      this.notifier.notify({
        type,
        userId,
        relatedEntity: null,
        metadata: { nombre: firstName }
      }).catch(err => logger.warn(`Error enviando notificacion ${type}`, { error: err.message, userId }));
    });
  }

  /** @private */
  _generateOtpCode() {
    if (MOCKS.EXTERNAL_PROVIDERS) {
      return '123456';
    }
    return crypto.randomInt(OTP_CODE_MIN, OTP_CODE_MAX).toString();
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace SmsMfaService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    unitOfWork?: typeof unitOfWork;
    userRepository?: typeof userRepository;
    verificationCodeRepository?: typeof verificationCodeRepository;
    notifier?: typeof notifier;
    SmsService?: typeof SmsService;
    account?: InstanceType<typeof MfaAccount>;
  }
}

export default SmsMfaService;
