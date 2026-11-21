import type { User } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { RequestAuditContext } from '../../../../shared/application/audit-context';
// modules/shared-endpoints/kyc/iam/services/auth-login/sms-login-challenge.service.ts
//
// Desafío MFA por SMS en el login: emisión y verificación del código.
// Extraído de AuthLoginService (SOLID: S).

import crypto from 'node:crypto';
import userRepository from '../../repositories/user.repository';
import auditModule from '../../../audit';
const { userLoginAttemptRepository, audit } = auditModule;
import notificationModule from '../../../notification';
const { verificationCodeRepository, SmsService } = notificationModule;
import AppError from '../../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../../shared/infrastructure/config';
const { MOCKS } = constantsModule;
import authLoginDtoModule from '../../responses/auth-login.response';
const { MFARequiredResponseDTO } = authLoginDtoModule;
import errorMessageModule from '../../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;
// ============================================================
// CONSTANTES
// ============================================================

const SMS_CHALLENGE_EXPIRY_MINUTES = 15;
const SMS_MAX_ATTEMPTS = 5;
const SMS_CODE_MIN = 100000;
const SMS_CODE_MAX = 999999;

class SmsLoginChallengeService {
  userRepository: typeof userRepository;
  userLoginAttemptRepository: typeof userLoginAttemptRepository;
  verificationCodeRepository: typeof verificationCodeRepository;
  SmsService: typeof SmsService;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   AuthLoginService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: SmsLoginChallengeService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.userLoginAttemptRepository = deps.userLoginAttemptRepository ?? userLoginAttemptRepository;
    this.verificationCodeRepository = deps.verificationCodeRepository ?? verificationCodeRepository;
    this.SmsService = deps.SmsService ?? SmsService;
  }

  // ============================================================
  // SMS MFA LOGIN CHALLENGE
  // ============================================================

  /** @private */
  async issue(user: Pick<User, 'userId' | 'preferredMfaMethod' | 'authUsername'>, nationalId: string) {
    const userWithPhone = await this.userRepository.findWithPrimaryPhone(user.userId);

    const phone = userWithPhone?.person?.contact?.phonePrimary;
    if (!phone) {
      throw AppError.badRequest('No tienes número de teléfono registrado para SMS MFA');
    }
    const phonePrefixId = userWithPhone?.person?.contact?.phonePrimaryPrefixId ?? null;

    const waitSeconds = await this.verificationCodeRepository.secondsUntilNewCode('phone', phone);
    if (waitSeconds > 0) {
      throw AppError.tooManyRequests(`Debes esperar ${waitSeconds} segundos antes de solicitar un nuevo código SMS`, null, waitSeconds);
    }

    const code = this._generateSmsCode();
    const expiresAt = new Date(Date.now() + SMS_CHALLENGE_EXPIRY_MINUTES * 60 * 1000);

    const verificationCode = await this.verificationCodeRepository.create({
      type: 'phone',
      contactValue: phone,
      code,
      expiresAt
    });

    // SMS por AWS SNS — envío no bloqueante (no debe demorar/tumbar el flujo de login).
    setImmediate(async () => {
      try {
        const phoneNumber = await this.SmsService.resolveE164(phone, phonePrefixId);
        const result = await this.SmsService.enviarSmsOtp({
          phoneNumber,
          message: `Tu código de verificación es ${code}. Vence en ${SMS_CHALLENGE_EXPIRY_MINUTES} minutos.`,
          userId: user.userId,
          purpose: 'mfa_login'
        });
        if (!result.success) {
          logger.warn('SMS login challenge no enviado', { userId: user.userId, error: result.error });
        }
      } catch (err) {
        logger.warn('Error enviando SMS login challenge', { userId: user.userId, error: errorMessage(err) });
      }
    });

    await audit.record('MFA_REQUIRED', {
      actorId: user.userId,
      details: { nationalId, challengeType: 'SMS_OTP' },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return MFARequiredResponseDTO({
      username: user.authUsername,
      session: verificationCode.verificationCodeId,
      challengeType: 'SMS_OTP',
      preferredMfaMethod: 'sms'
    });
  }

  /** @private */
  async verify(
    user: Pick<User, 'userId' | 'authUsername' | 'username'>,
    nationalId: string,
    code: string,
    { ip, userAgent, fingerprintHash }: Pick<RequestAuditContext, 'ip' | 'userAgent' | 'fingerprintHash'>
  ) {
    const userWithPhone = await this.userRepository.findWithPrimaryPhone(user.userId);

    const phone = userWithPhone?.person?.contact?.phonePrimary;
    if (!phone) {
      throw AppError.badRequest('No tienes número de teléfono registrado para SMS MFA');
    }

    const verificationCode = await this.verificationCodeRepository.findActiveByContact('phone', phone);
    if (!verificationCode || verificationCode.verifiedAt) {
      throw AppError.badRequest('Código SMS inválido o expirado');
    }

    const attempts = verificationCode.attempts ?? 0;
    if (attempts >= SMS_MAX_ATTEMPTS) {
      throw AppError.forbidden('Excediste el número máximo de intentos. Inicia sesión nuevamente');
    }

    if (verificationCode.code !== code) {
      await this.verificationCodeRepository.incrementAttempts(verificationCode.verificationCodeId);

      await this.userLoginAttemptRepository.recordAttempt({
        userId: user.userId,
        usernameAttempt: user.authUsername ?? user.username, // columna NOT NULL; auth_username es nullable
        nationalId: nationalId,
        ipAddress: ip,
        userAgent: userAgent,
        deviceFingerprint: fingerprintHash,
        success: false,
        failureReason: 'Codigo SMS incorrecto'
        // attempted_at lo pone recordAttempt
      });

      // Evento forense de seguridad (Opción A): se mantiene pese al log genérico del
      // middleware al propagar el throw. El intento queda en user_login_attempts.
      await audit.record('MFA_FAILED', {
        actorId: user.userId,
        details: { nationalId, reason: 'Codigo SMS incorrecto' },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users',
        outcome: 'failure'
      });

      const remaining = SMS_MAX_ATTEMPTS - (attempts + 1);
      throw AppError.badRequest(`Código SMS incorrecto. Te quedan ${remaining} intento(s)`);
    }

    await this.verificationCodeRepository.markAsVerified(verificationCode.verificationCodeId);
  }

  /** @private */
  _generateSmsCode() {
    if (MOCKS.EXTERNAL_PROVIDERS) {
      return '123456';
    }
    return String(crypto.randomInt(SMS_CODE_MIN, SMS_CODE_MAX + 1));
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace SmsLoginChallengeService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    userLoginAttemptRepository?: typeof userLoginAttemptRepository;
    verificationCodeRepository?: typeof verificationCodeRepository;
    SmsService?: typeof SmsService;
  }
}

export default SmsLoginChallengeService;
