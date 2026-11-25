// Los pasos del login que comparten el login por contraseña y el biométrico:
//
//   LoginPolicyGate      la política de privacidad vigente: si falta aceptarla, el login responde "política
//                        pendiente" (o la registra si el request ya trae acceptPolicy: true)
//   LoginDeviceResolver  el dispositivo del login: conocido, primero del usuario (trusted) o nuevo (pending)
//   SmsLoginChallenge    el segundo factor por SMS: emisión y verificación del código
import type { AuditEntry } from '../../../../shared/application/ports/audit-trail.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import { DeviceBlockedError, IamForbiddenError, IamInvalidInputError, IamRateLimitedError } from '../../domain/errors';
import { policyPending, type ActivePolicy } from '../../domain/login';
import type { TrustedDevice } from '../../domain/trusted-device';
import { loginHandle, type LoginUser, type UserAccount } from '../../domain/user';
import authLoginDtoModule from '../dto/auth-login.output';
import type { IamDeps } from './iam-deps';

const { errorMessage } = errorMessageModule;
const { PolicyUpdateRequiredDTO, MFARequiredResponseDTO } = authLoginDtoModule;

/** El contexto HTTP del login: desde dónde y con qué dispositivo se pide. */
export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
  fingerprintHash?: string | null;
  clientType?: string | null;
  serverContext?: string | null;
  acceptPolicy?: boolean;
  pushToken?: string | null;
  pushDeviceId?: string | null;
  pushPlatform?: string | null;
}

// ============================================================
// POLÍTICA DE PRIVACIDAD
// ============================================================

export class LoginPolicyGate {
  constructor(private readonly deps: Pick<IamDeps, 'users' | 'privacyPolicies' | 'consents' | 'audit' | 'logger'>) {}

  /**
   * null → el login continúa (política al día, o aceptada en este request); si no, la respuesta "política pendiente".
   * `blockedAuditAction`: la acción que se audita al bloquear; `source`: el origen para los logs.
   */
  async check(
    user: LoginUser,
    acceptPolicy: boolean | undefined,
    ip: string | null,
    { blockedAuditAction, source }: { blockedAuditAction: string; source: string }
  ) {
    const activePolicy = await this.deps.privacyPolicies.findActive();
    if (!policyPending(user, activePolicy)) {
      return null;
    }

    if (acceptPolicy === true) {
      await this.accept(user, activePolicy, ip, source);
      return null;
    }

    await this.deps.audit.record(blockedAuditAction, {
      actorId: user.userId,
      details: { userVersion: user.privacyPolicyVersion || 'ninguna', activeVersion: activePolicy.version },
      entityType: 'PrivacyPolicy',
      entityTable: 'privacy_policies',
      outcome: 'failure'
    });

    return PolicyUpdateRequiredDTO({
      currentVersion: user.privacyPolicyVersion || null,
      newVersion: activePolicy.version,
      documentUrl: activePolicy.documentUrl,
      summary: activePolicy.summary,
      effectiveDate: activePolicy.effectiveDate
    });
  }

  /** El cliente aceptó en este mismo request: registrar y dejar pasar. */
  private async accept(user: LoginUser, activePolicy: ActivePolicy, ip: string | null, source: string) {
    const { users, consents, audit, logger } = this.deps;
    await users.update(user.userId, {
      privacyPolicyVersion: activePolicy.version,
      privacyPolicyAcceptedAt: new Date(),
      privacyPolicyAcceptedIp: ip || null
    });

    // RF-ADM-04: trazabilidad granular en user_consents (best-effort)
    await consents
      .grantPrivacyPolicy({ userId: user.userId, privacyPolicyId: activePolicy.privacyPolicyId, ip })
      .catch(err =>
        logger.warn(`${source}: no se pudo registrar user_consent de privacy policy`, { userId: user.userId, error: err.message })
      );

    await audit.record('PRIVACY_POLICY_ACCEPTED', {
      actorId: user.userId,
      details: { version: activePolicy.version, ip: ip || null },
      entityType: 'PrivacyPolicy',
      entityTable: 'privacy_policies'
    });
  }
}

// ============================================================
// DISPOSITIVO DEL LOGIN
// ============================================================

export interface ResolvedDevice {
  requiresApproval: false;
  deviceId: string;
  deviceHmacSecret: string | null;
}

export class LoginDeviceResolver {
  constructor(private readonly deps: Pick<IamDeps, 'devices' | 'deviceDescriber' | 'audit' | 'notifier' | 'logger' | 'policy'>) {}

  /**
   * Corre síncronamente: su resultado puede bloquear el login.
   * [RF-AUTH-03] | CA-03 | El dispositivo es nuevo si su huella no se conoce. Uno conocido desde otra IP o ubicación
   * no genera alerta (decisión técnica: evitar ruido por VPNs y roaming).
   */
  async resolve(user: LoginUser, { ip = null, userAgent = null, fingerprintHash }: LoginContext): Promise<ResolvedDevice> {
    const { devices, deviceDescriber } = this.deps;
    // audit.middleware siempre la calcula; sin ella la consulta fallaba con WHERE undefined
    if (!fingerprintHash) {
      throw new IamInvalidInputError('No se pudo identificar el dispositivo');
    }

    const existing = await devices.findByFingerprint(user.userId, fingerprintHash);
    if (existing) {
      return this.existing(user.userId, fingerprintHash, existing);
    }

    const described = deviceDescriber.describe(userAgent, ip);
    const isFirstDevice = (await devices.countTrusted(user.userId)) === 0;
    return isFirstDevice ? this.registerFirst(user, fingerprintHash, ip, described) : this.registerPending(user, fingerprintHash, ip, described);
  }

  private async existing(userId: string, fingerprintHash: string, existing: TrustedDevice): Promise<ResolvedDevice> {
    if (existing.status === 'blocked') {
      // Evento forense de seguridad: política de dispositivo bloqueado (se mantiene pese al log genérico del error)
      await this.deps.audit.record('LOGIN_BLOCKED_DEVICE', {
        actorId: userId,
        entityId: existing.userTrustedDeviceId,
        entityType: 'UserTrustedDevice',
        entityTable: 'userTrustedDevices',
        outcome: 'failure'
      });
      throw new DeviceBlockedError(null);
    }

    // trusted o pending → puede loguearse, actualiza last_seen
    await this.deps.devices.updateLastSeen(userId, fingerprintHash);
    return { requiresApproval: false, deviceId: existing.userTrustedDeviceId, deviceHmacSecret: existing.hmacSecret };
  }

  // [RF-AUTH-03] | CA-03 | Primer dispositivo del usuario → trusted automático, sin notificación
  private async registerFirst(
    user: LoginUser,
    fingerprintHash: string,
    ip: string | null,
    described: ReturnType<IamDeps['deviceDescriber']['describe']>
  ): Promise<ResolvedDevice> {
    const { browser, os, deviceType, city, country, countryCode, deviceName } = described;
    const device = await this.deps.devices.create({
      userId: user.userId,
      fingerprintHash,
      deviceName,
      status: 'trusted',
      ipAddress: ip,
      browser,
      os,
      deviceType,
      city,
      country,
      countryCode,
      trustedAt: new Date(),
      lastSeenAt: new Date()
    });

    await this.deps.audit.record('TRUSTED_DEVICE_ADDED_FIRST', {
      actorId: user.userId,
      details: { deviceName },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return { requiresApproval: false, deviceId: device.userTrustedDeviceId, deviceHmacSecret: device.hmacSecret };
  }

  // [RF-AUTH-03] | CA-03 | Segundo dispositivo en adelante → pending + NUEVO_DISPOSITIVO_DETECTADO (fire-and-forget)
  private async registerPending(
    user: LoginUser,
    fingerprintHash: string,
    ip: string | null,
    described: ReturnType<IamDeps['deviceDescriber']['describe']>
  ): Promise<ResolvedDevice> {
    const { devices, audit, notifier, logger, policy } = this.deps;
    const { browser, os, deviceType, city, country, countryCode, deviceName } = described;
    const device = await devices.create({
      userId: user.userId,
      fingerprintHash,
      deviceName,
      status: 'pending',
      ipAddress: ip,
      browser,
      os,
      deviceType,
      city,
      country,
      countryCode,
      lastSeenAt: new Date()
    });

    await audit.record('TRUSTED_DEVICE_PENDING', {
      actorId: user.userId,
      details: { deviceName },
      entityId: device.userTrustedDeviceId,
      entityType: 'UserTrustedDevice',
      entityTable: 'user_trusted_devices'
    });

    notifier
      .notify({
        type: 'NUEVO_DISPOSITIVO_DETECTADO',
        userId: user.userId,
        relatedEntity: null,
        metadata: {
          nombre: user.person?.firstName || 'Usuario',
          email: user.person?.contact?.email,
          ip,
          browser: browser || 'Desconocido',
          os: os || 'Desconocido',
          ciudad: city || 'Desconocida',
          pais: country || 'Desconocido',
          deviceName,
          fechaAcceso: new Date().toISOString(),
          logoUrl: policy.notificationLogoUrl
        }
      })
      .catch(err => logger.warn('Error sending new device notification', { error: err.message }));

    return { requiresApproval: false, deviceId: device.userTrustedDeviceId, deviceHmacSecret: device.hmacSecret };
  }
}

// ============================================================
// RETO MFA POR SMS
// ============================================================

const SMS_CHALLENGE_EXPIRY_MINUTES = 15;
const SMS_MAX_ATTEMPTS = 5;
const SMS_CODE_MIN = 100000;
const SMS_CODE_MAX = 999999;

export class SmsLoginChallenge {
  constructor(
    private readonly deps: Pick<IamDeps, 'users' | 'loginAttempts' | 'verificationCodes' | 'sms' | 'audit' | 'logger' | 'random' | 'policy'>
  ) {}

  private async phoneOf(userId: string) {
    const userWithPhone = await this.deps.users.findWithPrimaryPhone(userId);
    const phone = userWithPhone?.person?.contact?.phonePrimary;
    if (!phone) {
      throw new IamInvalidInputError('No tienes número de teléfono registrado para SMS MFA');
    }
    return { phone, phonePrefixId: userWithPhone?.person?.contact?.phonePrimaryPrefixId ?? null };
  }

  async issue(user: Pick<UserAccount, 'userId' | 'authUsername'>, nationalId: string) {
    const { verificationCodes, sms, audit, logger } = this.deps;
    const { phone, phonePrefixId } = await this.phoneOf(user.userId);

    const waitSeconds = await verificationCodes.secondsUntilNewCode('phone', phone);
    if (waitSeconds > 0) {
      throw new IamRateLimitedError(`Debes esperar ${waitSeconds} segundos antes de solicitar un nuevo código SMS`, waitSeconds);
    }

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + SMS_CHALLENGE_EXPIRY_MINUTES * 60 * 1000);
    const verificationCode = await verificationCodes.create({ type: 'phone', contactValue: phone, code, expiresAt });

    // SMS en segundo plano: no debe demorar ni tumbar el login
    setImmediate(async () => {
      try {
        const phoneNumber = await sms.resolveE164(phone, phonePrefixId);
        const result = await sms.send({
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

  async verify(user: Pick<UserAccount, 'userId' | 'authUsername' | 'username'>, nationalId: string, code: string, context: LoginContext) {
    const { verificationCodes, loginAttempts, audit } = this.deps;
    const { phone } = await this.phoneOf(user.userId);

    const verificationCode = await verificationCodes.findActive('phone', phone);
    if (!verificationCode || verificationCode.verifiedAt) {
      throw new IamInvalidInputError('Código SMS inválido o expirado');
    }

    const attempts = verificationCode.attempts ?? 0;
    if (attempts >= SMS_MAX_ATTEMPTS) {
      throw new IamForbiddenError('Excediste el número máximo de intentos. Inicia sesión nuevamente');
    }

    if (verificationCode.code !== code) {
      await verificationCodes.incrementAttempts(verificationCode.verificationCodeId);
      await loginAttempts.record({
        userId: user.userId,
        usernameAttempt: loginHandle(user),
        nationalId,
        ipAddress: context.ip,
        userAgent: context.userAgent,
        deviceFingerprint: context.fingerprintHash,
        success: false,
        failureReason: 'Codigo SMS incorrecto'
      });
      // Evento forense de seguridad: el intento queda además en user_login_attempts
      await audit.record('MFA_FAILED', {
        actorId: user.userId,
        details: { nationalId, reason: 'Codigo SMS incorrecto' },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users',
        outcome: 'failure'
      } satisfies AuditEntry);

      const remaining = SMS_MAX_ATTEMPTS - (attempts + 1);
      throw new IamInvalidInputError(`Código SMS incorrecto. Te quedan ${remaining} intento(s)`);
    }

    await verificationCodes.markAsVerified(verificationCode.verificationCodeId);
  }

  private generateCode() {
    if (this.deps.policy.mockOtpCodes) {
      return '123456';
    }
    return String(this.deps.random.int(SMS_CODE_MIN, SMS_CODE_MAX + 1));
  }
}
