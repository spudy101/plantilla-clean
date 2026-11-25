// Casos de uso: iniciar sesión con documento + contraseña (Login) y completar el segundo factor (VerifyMfaLogin).
//
// La contraseña se valida contra el hash local. Si el usuario tiene un método MFA preferido, el login emite el reto
// (TOTP o SMS) en vez de completar la sesión; verify-mfa lo valida y recién ahí emite los tokens.
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { IamInvalidInputError, IamRateLimitedError, IamUnauthorizedError, InactiveAccountError } from '../../domain/errors';
import { accountBlockedError, assertPortalAccess } from '../../domain/login';
import { loginHandle, type LoginUser } from '../../domain/user';
import authLoginDtoModule from '../dto/auth-login.output';
import type { IamDeps } from './iam-deps';
import type { LoginContext, LoginDeviceResolver, LoginPolicyGate, SmsLoginChallenge } from './login-steps';
import type { SessionControl, SessionIssuer } from './sessions';

const { errorMessage } = errorMessageModule;
const { LoginResponseDTO, MFARequiredResponseDTO } = authLoginDtoModule;

export interface LoginInput {
  nationalId: string;
  password: string;
  acceptPolicy?: boolean;
}

export interface VerifyMfaInput {
  nationalId: string;
  totpCode?: string;
  smsCode?: string;
  /** Token de reto MFA que devolvió /auth/login. */
  session?: string;
  acceptPolicy?: boolean;
}

type LoginDeps = Pick<
  IamDeps,
  | 'users'
  | 'loginAttempts'
  | 'rateLimiter'
  | 'revocations'
  | 'tokens'
  | 'passwords'
  | 'totp'
  | 'cipher'
  | 'pushDevices'
  | 'audit'
  | 'notifier'
  | 'logger'
  | 'policy'
> & {
  policyGate: LoginPolicyGate;
  loginDevices: LoginDeviceResolver;
  smsChallenge: SmsLoginChallenge;
  sessionControl: SessionControl;
  sessionIssuer: SessionIssuer;
};

/** Lo que comparten los dos pasos del login. */
abstract class LoginFlow {
  constructor(protected readonly deps: LoginDeps) {}

  /** Bloqueo de la cuenta por intentos fallidos: primero Redis; si no está, el respaldo en la base. */
  // [RF-AUTH-02] | CA-05 | Segunda capa de rate limiting por cuenta
  protected async checkAccountBlock(nationalId: string) {
    const redisSecs = await this.deps.rateLimiter.checkAccountBlock(nationalId);
    if (redisSecs !== null) {
      throw accountBlockedError(redisSecs);
    }
    const blockStatus = await this.deps.loginAttempts.findBlock(nationalId);
    if (blockStatus?.blocked) {
      throw accountBlockedError(blockStatus.remainingMinutes * 60, blockStatus.remainingMinutes);
    }
  }

  protected async userForLogin(nationalId: string): Promise<LoginUser> {
    const user = await this.deps.users.findLoginUserByNationalId(nationalId);
    if (!user) {
      throw new IamInvalidInputError('Credenciales invalidas');
    }
    if (!user.isActive) {
      throw new InactiveAccountError();
    }
    return user;
  }

  /** Bloqueo, usuario, portal y política: lo mismo en los dos pasos. null → seguir; si no, la respuesta. */
  protected async precheck(nationalId: string, acceptPolicy: boolean, context: LoginContext) {
    await this.checkAccountBlock(nationalId);
    const user = await this.userForLogin(nationalId);
    assertPortalAccess(user, context.serverContext);
    const policyCheck = await this.deps.policyGate.check(user, acceptPolicy, context.ip ?? null, {
      blockedAuditAction: 'LOGIN_BLOCKED_POLICY_UPDATE',
      source: 'auth-login'
    });
    return { user, policyCheck };
  }

  protected async completeSuccessfulLogin(user: LoginUser, nationalId: string, context: LoginContext) {
    const { rateLimiter, revocations, loginAttempts, audit, logger, sessionControl, sessionIssuer, loginDevices } = this.deps;
    const { ip, userAgent, fingerprintHash } = context;

    // Dispositivo (síncrono: puede bloquear el login)
    const device = await loginDevices.resolve(user, context);

    // Una sesión por dispositivo + límite de sesiones simultáneas. La previa se cierra ANTES de contar el tope:
    // una sesión abandonada del mismo dispositivo no debe consumir cupo. Mismo orden que el login biométrico.
    await sessionControl.closePreviousDeviceSessions(user.userId, device.deviceId);
    await sessionControl.enforceSessionLimit(user.userId);

    // Limpia una invalidación global previa (logout-all): el refresh nuevo debe poder renovar
    revocations
      .clearUserInvalidation(user.userId)
      .catch(err => logger.warn('Error limpiando invalidación de usuario en login', { error: err.message, userId: user.userId }));

    rateLimiter
      .resetAccountCounters(nationalId)
      .catch(err => logger.warn('Error reseteando contadores de login en Redis', { error: err.message, userId: user.userId }));

    const { sessionId, tokens } = await sessionIssuer.issue(user, { deviceId: device.deviceId, ip, userAgent, source: 'login' });

    // Push token (solo mobile, fire-and-forget): no bloquea el login
    const { pushToken, pushDeviceId, pushPlatform } = context;
    if (pushToken && pushPlatform) {
      this.registerPushToken(user.userId, pushToken, pushPlatform, pushDeviceId ?? null).catch(err =>
        logger.warn('Error registrando push token en login', { error: err.message, userId: user.userId })
      );
    }

    await loginAttempts.record({
      userId: user.userId,
      usernameAttempt: loginHandle(user),
      nationalId,
      ipAddress: ip,
      userAgent,
      deviceFingerprint: fingerprintHash,
      success: true,
      // Explícito: POST /auth/login es ruta pública y el contexto de la operación no tiene la sesión recién creada
      originSessionId: sessionId
    });

    await audit.record('LOGIN_SUCCESS', {
      actorId: user.userId,
      details: { nationalId, fingerprintHash, deviceId: device.deviceId },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return LoginResponseDTO({
      user,
      tokens,
      deviceId: device.deviceId,
      // Solo mobile recibe el secreto HMAC del dispositivo (lo guarda en el keychain); la web usa cookies httpOnly
      deviceHmacSecret: context.clientType === 'mobile' ? device.deviceHmacSecret : null
    });
  }

  /** Registra (o actualiza) el push token del dispositivo móvil. Nunca lanza: un error no interrumpe el login. */
  private async registerPushToken(userId: string, token: string, platform: string, deviceId: string | null) {
    try {
      await this.deps.pushDevices.register({ userId, token, platform, deviceId });
      this.deps.logger.info('Push token registrado exitosamente en login', { userId, platform, deviceId: deviceId || 'sin device_id' });
    } catch (error) {
      this.deps.logger.warn('Error al registrar push token en login', { error: errorMessage(error), userId, platform, deviceId });
    }
  }
}

export class Login extends LoginFlow {
  async execute(data: LoginInput, context: LoginContext) {
    const { passwords, tokens, audit, smsChallenge } = this.deps;
    const { nationalId, password, acceptPolicy = false } = data;

    const { user, policyCheck } = await this.precheck(nationalId, acceptPolicy, context);
    if (policyCheck) {
      return policyCheck;
    }

    if (!(await passwords.matches(password, user.passwordHash))) {
      await this.handleFailedLogin(user, nationalId, context, 'Contrasena invalida');
    }

    // Segundo factor: con un método preferido se emite el reto en vez de completar el login
    if (user.preferredMfaMethod === 'totp') {
      await audit.record('MFA_REQUIRED', {
        actorId: user.userId,
        details: { nationalId, challengeType: 'SOFTWARE_TOKEN_MFA' },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users'
      });
      // El token de reto prueba que la contraseña ya pasó el paso 1: verify-mfa lo exige antes del código TOTP
      const challengeToken = await tokens.generateMfaChallengeToken(user.userId);
      return MFARequiredResponseDTO({
        username: user.authUsername,
        session: challengeToken,
        challengeType: 'SOFTWARE_TOKEN_MFA',
        preferredMfaMethod: 'totp'
      });
    }

    if (user.preferredMfaMethod === 'sms') {
      return smsChallenge.issue(user, nationalId);
    }

    return this.completeSuccessfulLogin(user, nationalId, context);
  }

  // [RF-AUTH-02] | CA-05 | Segunda capa de rate limiting por cuenta. Siempre lanza.
  private async handleFailedLogin(user: LoginUser, nationalId: string, context: LoginContext, reason: string): Promise<never> {
    const { loginAttempts, rateLimiter, audit, notifier, logger, policy } = this.deps;
    // El intento queda en la base (sin blocked_until: el bloqueo lo lleva Redis)
    await loginAttempts.record({
      userId: user.userId,
      usernameAttempt: loginHandle(user),
      nationalId,
      ipAddress: context.ip,
      userAgent: context.userAgent,
      deviceFingerprint: context.fingerprintHash,
      success: false,
      failureReason: reason
    });

    const blockSecs = await rateLimiter.incrementAccountFailures(nationalId);
    const MAX = policy.maxAccountAttempts;

    // Eventos forenses de seguridad: LOGIN_FAILED y ACCOUNT_BLOCKED se mantienen a propósito pese al log genérico
    await audit.record('LOGIN_FAILED', {
      actorId: user.userId,
      details: { nationalId, reason, blocked: blockSecs !== null },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users',
      outcome: 'failure'
    });

    if (blockSecs !== null) {
      const minutes = Math.ceil(blockSecs / 60);
      await audit.record('ACCOUNT_BLOCKED', {
        actorId: user.userId,
        details: { nationalId, blockSecs, reason: `${MAX} intentos fallidos consecutivos` },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users',
        outcome: 'failure'
      });

      notifier
        .notify({
          type: 'ACCOUNT_BLOCKED',
          userId: user.userId,
          metadata: { nombre: user.person?.firstName || 'Usuario', intentosFallidos: MAX, minutosBloqueo: minutes }
        })
        .catch(err => logger.warn('Error enviando notificación account blocked', { error: err.message }));

      throw new IamRateLimitedError(`Cuenta bloqueada por ${minutes} minutos debido a múltiples intentos fallidos`, blockSecs);
    }

    throw new IamInvalidInputError('Contraseña incorrecta');
  }
}

export class VerifyMfaLogin extends LoginFlow {
  async execute(data: VerifyMfaInput, context: LoginContext) {
    const { totp, cipher, loginAttempts, audit, smsChallenge } = this.deps;
    const { nationalId, totpCode, smsCode, session, acceptPolicy = false } = data;

    const { user, policyCheck } = await this.precheck(nationalId, acceptPolicy, context);
    if (policyCheck) {
      return policyCheck;
    }

    if (user.preferredMfaMethod === 'sms') {
      const smsOtp = smsCode || totpCode;
      if (!smsOtp) {
        throw new IamInvalidInputError('Falta el código SMS');
      }
      await smsChallenge.verify(user, nationalId, smsOtp, context);
      return this.completeSuccessfulLogin(user, nationalId, context);
    }

    // TOTP: el token de reto prueba que la contraseña ya se validó en /auth/login (sin esto, alguien con el
    // documento y un código TOTP podría saltarse la contraseña)
    await this.assertMfaChallenge(session, user.userId);

    const secret = user.totpSecret ? cipher.decrypt(user.totpSecret) : null;
    if (!totp.verify(totpCode, secret)) {
      await loginAttempts.record({
        userId: user.userId,
        usernameAttempt: loginHandle(user),
        nationalId,
        ipAddress: context.ip,
        userAgent: context.userAgent,
        deviceFingerprint: context.fingerprintHash,
        success: false,
        failureReason: 'Codigo TOTP incorrecto'
      });
      // Evento forense de seguridad: el intento queda además en user_login_attempts
      await audit.record('MFA_FAILED', {
        actorId: user.userId,
        details: { nationalId, reason: 'Codigo TOTP incorrecto' },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users',
        outcome: 'failure'
      });
      throw new IamInvalidInputError('Código TOTP incorrecto');
    }

    return this.completeSuccessfulLogin(user, nationalId, context);
  }

  /** El reto MFA emitido en /auth/login debe ser válido y de este mismo usuario. */
  private async assertMfaChallenge(session: string | null | undefined, userId: string) {
    if (!session) {
      throw new IamUnauthorizedError('Falta el token de reto MFA. Vuelve a iniciar sesión.');
    }
    const payload = await this.deps.tokens.verifyMfaChallengeToken(session);
    if (payload.userId !== userId) {
      throw new IamUnauthorizedError('El reto MFA no corresponde a este usuario. Vuelve a iniciar sesión.');
    }
  }
}
