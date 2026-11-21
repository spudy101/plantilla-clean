import type { UserWith } from '../repositories/user.repository';
import { interopDefault } from '../../../shared/kernel/interop.util';
import type { RequestAuditContext } from '../../../shared/application/audit-context';
import userRepository from '../repositories/user.repository';
import auditModule from '../../audit';
const { userLoginAttemptRepository, audit } = auditModule;
import notificationModule from '../../notification';
const { verificationCodeRepository, notifier, SmsService } = notificationModule;
import userSessionRepository from '../repositories/user-session.repository';
import trustedDeviceRepository from '../repositories/auth-trusted-device.repository';
import legalModule from '../../legal';
const { privacyPolicyRepository, consentRecorder } = legalModule;
import JwtUtil from '../../../shared/infrastructure/security/jwt.util';
import TotpUtil from '../../../shared/infrastructure/security/totp.util';
import EncryptionUtil from '../../../shared/infrastructure/security/encryption.util';
import TokenBlacklistUtil from '../utils/token-blacklist.util';
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import LoginRateLimiter from '../utils/login-rate-limiter.util';
import constantsModule from '../../../shared/infrastructure/config';
const {
  LOGIN_RATE_LIMIT,
  CLIENT_ACCESS_ROLES,
  INTERNAL_ROLE_NAMES
} = constantsModule;
import authLoginDtoModule from '../responses/auth-login.response';
const { LoginResponseDTO, MFARequiredResponseDTO } = authLoginDtoModule;
import TokenRefreshService from './auth-login/token-refresh.service';
import AuthLogoutService from './auth-login/auth-logout.service';
import TrustedDeviceManagementService from './auth-login/trusted-device-management.service';
import SessionControlService from './auth-login/session-control.service';
import LoginDeviceService from './auth-login/login-device.service';
import SmsLoginChallengeService from './auth-login/sms-login-challenge.service';
import LoginPolicyGateService from './auth-login/login-policy-gate.service';
import SessionIssuerService from './auth-login/session-issuer.service';
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;
// ============================================================
// AUTH LOGIN SERVICE — fachada
// ============================================================
// SOLID (S): este service tenía ~1600 líneas (login, MFA, refresh, logout,
// dispositivos y sesiones). Ahora el flujo de login vive aquí y el resto en
// servicios con una sola responsabilidad (carpeta auth-login/):
//   - TokenRefreshService             → rotación de refresh tokens
//   - AuthLogoutService               → logout / logoutAll
//   - TrustedDeviceManagementService  → gestión de dispositivos por el usuario
//   - SessionControlService           → cierre selectivo y límite de sesiones
//   - LoginDeviceService              → resolución del dispositivo en el login
//   - SmsLoginChallengeService        → desafío MFA por SMS
//   - LoginPolicyGateService          → política de privacidad al iniciar sesión (también biométrico)
//   - SessionIssuerService            → emisión de tokens + sesión (también biométrico y registro)
// La API pública no cambia: los métodos movidos se delegan al final de la clase.
// ============================================================

class AuthLoginService {
  userRepository: typeof userRepository;
  userLoginAttemptRepository: typeof userLoginAttemptRepository;
  verificationCodeRepository: typeof verificationCodeRepository;
  userSessionRepository: typeof userSessionRepository;
  trustedDeviceRepository: typeof trustedDeviceRepository;
  privacyPolicyRepository: typeof privacyPolicyRepository;
  consentRecorder: typeof consentRecorder;
  notifier: typeof notifier;
  SmsService: typeof SmsService;
  tokenRefresh: InstanceType<typeof TokenRefreshService>;
  logoutService: InstanceType<typeof AuthLogoutService>;
  trustedDevices: InstanceType<typeof TrustedDeviceManagementService>;
  sessionControl: InstanceType<typeof SessionControlService>;
  loginDevices: InstanceType<typeof LoginDeviceService>;
  smsChallenge: InstanceType<typeof SmsLoginChallengeService>;
  policyGate: InstanceType<typeof LoginPolicyGateService>;
  sessionIssuer: InstanceType<typeof SessionIssuerService>;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AuthLoginService({ userRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: AuthLoginService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.userLoginAttemptRepository = deps.userLoginAttemptRepository ?? userLoginAttemptRepository;
    this.verificationCodeRepository = deps.verificationCodeRepository ?? verificationCodeRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
    this.trustedDeviceRepository = deps.trustedDeviceRepository ?? trustedDeviceRepository;
    this.privacyPolicyRepository = deps.privacyPolicyRepository ?? privacyPolicyRepository;
    this.consentRecorder = deps.consentRecorder ?? consentRecorder;
    this.notifier = deps.notifier ?? notifier;
    this.SmsService = deps.SmsService ?? SmsService;

    // Sub-servicios por responsabilidad (SOLID: S). Reciben las mismas dependencias.
    const shared = {
      userRepository: this.userRepository,
      userLoginAttemptRepository: this.userLoginAttemptRepository,
      verificationCodeRepository: this.verificationCodeRepository,
      userSessionRepository: this.userSessionRepository,
      trustedDeviceRepository: this.trustedDeviceRepository,
      privacyPolicyRepository: this.privacyPolicyRepository,
      consentRecorder: this.consentRecorder,
      notifier: this.notifier,
      SmsService: this.SmsService
    };
    this.tokenRefresh = deps.tokenRefresh ?? new TokenRefreshService(shared);
    this.logoutService = deps.logoutService ?? new AuthLogoutService(shared);
    this.trustedDevices = deps.trustedDevices ?? new TrustedDeviceManagementService(shared);
    this.sessionControl = deps.sessionControl ?? new SessionControlService(shared);
    this.loginDevices = deps.loginDevices ?? new LoginDeviceService(shared);
    this.smsChallenge = deps.smsChallenge ?? new SmsLoginChallengeService(shared);
    this.policyGate = deps.policyGate ?? new LoginPolicyGateService(shared);
    this.sessionIssuer = deps.sessionIssuer ?? new SessionIssuerService(shared);
  }

  // ============================================================
  // LOGIN
  // ============================================================

  async login(data: AuthLoginService.LoginInput, auditContext: RequestAuditContext) {
    const { nationalId, password, acceptPolicy = false } = data;
    const { ip, userAgent, fingerprintHash } = auditContext;

    await this._checkAccountBlock(nationalId);

    const user = await this._getUserForLogin(nationalId);

    this._checkServerRole(user, auditContext.serverContext);

    const policyCheck = await this._checkPrivacyPolicy(user, acceptPolicy, ip);
    if (policyCheck) {
      return policyCheck;
    }

    const isValid = await this.userRepository.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      await this._handleFailedLogin(user, nationalId, { ip, userAgent, fingerprintHash }, 'Contrasena invalida');
    }

    // ── Segundo factor (MFA) — gestionado íntegramente por nosotros ──────────────
    // La contraseña ya se validó arriba contra el hash bcrypt local. Si el usuario
    // tiene un método MFA preferido, emitimos el reto correspondiente en lugar de
    // completar el login directamente.
    if (user.preferredMfaMethod === 'totp') {
      await audit.record('MFA_REQUIRED', {
        actorId: user.userId,
        details: { nationalId, challengeType: 'SOFTWARE_TOKEN_MFA' },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users'
      });

      // El token de reto prueba que la contraseña ya pasó el paso 1: verify-mfa lo
      // exige antes de aceptar el código TOTP (reemplaza al `session` de Cognito).
      const challengeToken = await JwtUtil.generateMfaChallengeToken(user.userId);

      return MFARequiredResponseDTO({
        username: user.authUsername,
        session: challengeToken,
        challengeType: 'SOFTWARE_TOKEN_MFA',
        preferredMfaMethod: 'totp'
      });
    }

    if (user.preferredMfaMethod === 'sms') {
      return this.smsChallenge.issue(user, nationalId);
    }

    // Sin MFA: emitimos directamente nuestros tokens RS256.
    return this._completeSuccessfulLogin(user, nationalId, auditContext);
  }

  async verifyMFA(data: AuthLoginService.VerifyMfaInput, auditContext: RequestAuditContext) {
    const { nationalId, totpCode, smsCode, session, acceptPolicy = false } = data;
    const { ip, userAgent, fingerprintHash } = auditContext;

    await this._checkAccountBlock(nationalId);

    const user = await this._getUserForLogin(nationalId);

    this._checkServerRole(user, auditContext.serverContext);

    const policyCheck = await this._checkPrivacyPolicy(user, acceptPolicy, ip);
    if (policyCheck) {
      return policyCheck;
    }

    if (user.preferredMfaMethod === 'sms') {
      const smsOtp = smsCode || totpCode;
      if (!smsOtp) {
        throw AppError.badRequest('Falta el código SMS');
      }
      await this.smsChallenge.verify(user, nationalId, smsOtp, {
        ip,
        userAgent,
        fingerprintHash
      });
      return this._completeSuccessfulLogin(user, nationalId, auditContext);
    }

    // ── TOTP nativo ──────────────────────────────────────────────────────────────
    // El token de reto (session) prueba que la contraseña ya se validó en /auth/login;
    // sin esto, alguien con el nationalId y un código TOTP podría saltarse la contraseña.
    await this._assertMfaChallenge(session, user.userId);

    const secret = user.totpSecret ? EncryptionUtil.decrypt(user.totpSecret) : null;
    if (!TotpUtil.verify(totpCode, secret)) {
      await this.userLoginAttemptRepository.recordAttempt({
        userId: user.userId,
        usernameAttempt: user.authUsername ?? user.username, // columna NOT NULL; auth_username es nullable
        nationalId: nationalId,
        ipAddress: ip,
        userAgent: userAgent,
        deviceFingerprint: fingerprintHash,
        success: false,
        failureReason: 'Codigo TOTP incorrecto'
      // attempted_at lo pone recordAttempt
      });

      // Evento forense de seguridad (Opción A): se mantiene a propósito pese al log
      // genérico que el middleware emite al propagar el throw. El intento queda además
      // persistido en user_login_attempts. No es duplicación a corregir.
      await audit.record('MFA_FAILED', {
        actorId: user.userId,
        details: {
          nationalId,
          reason: 'Codigo TOTP incorrecto'
        },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users',
        outcome: 'failure'
      });

      throw AppError.badRequest('Código TOTP incorrecto');
    }

    return this._completeSuccessfulLogin(user, nationalId, auditContext);
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /**
   * Verifica si el usuario tiene la versión activa de la política de privacidad.
   * Si el request trae `acceptPolicy: true`, registra la versión activa y deja continuar el login
   * y deja continuar el login en un solo paso.
   *
   * Retorna:
   *   null                     → política al día (o aceptada en este request), el login continúa
   *   PolicyUpdateRequiredDTO  → política desactualizada y no se aceptó en este request
   *
   * @param {Object} user
   * @param {boolean} acceptPolicy - true si el usuario aceptó la política en este request
   * @param {string|null} ip
   * @private
   */
  _checkPrivacyPolicy(user: UserWith<'login'>, acceptPolicy: boolean, ip: string | null | undefined) {
    return this.policyGate.check(user, acceptPolicy, ip ?? null, {
      blockedAuditAction: 'LOGIN_BLOCKED_POLICY_UPDATE',
      source: 'auth-login'
    });
  }

  /** @private */
  _checkServerRole(user: UserWith<'login'>, serverContext: string | null | undefined) {
    if (!serverContext) {
      return;
    }
    const allowedRoles: Record<string, readonly string[] | undefined> = {
      // El portal admin admite todos los roles INTERNOS (SUPERADMIN/ADMIN/AUDITOR).
      // Qué puede hacer cada uno lo decide RbacMiddleware por ruta; aquí solo se
      // controla el acceso al portal.
      admin: [...INTERNAL_ROLE_NAMES],
      // El portal cliente admite el rol CLIENTE.
      client: CLIENT_ACCESS_ROLES
    };
    const allowed = allowedRoles[serverContext];
    if (allowed && !(user.role && allowed.includes(user.role.name))) {
      throw AppError.forbidden('No tienes permiso para acceder a este portal');
    }
  }

  /** @private */
  // [RF-AUTH-02] | CA-05 | Segunda capa de rate limiting por cuenta (bonus, no exigido por CA-05)
  async _checkAccountBlock(nationalId: string) {
    // Verificar bloqueo en Redis (primario)
    const redisSecs = await LoginRateLimiter.checkAccountBlock(nationalId);
    if (redisSecs !== null) {
      const minutes = Math.ceil(redisSecs / 60);
      throw AppError.tooManyRequests(
        `Cuenta bloqueada temporalmente. Intenta nuevamente en ${minutes} minuto(s)`,
        null,
        redisSecs
      );
    }

    // Fallback: verificar bloqueo en DB (si Redis no está disponible)
    const blockStatus = await this.userLoginAttemptRepository.checkIfBlocked(nationalId);
    if (blockStatus?.blocked) {
      const retrySecs = blockStatus.remainingMinutes * 60;
      throw AppError.tooManyRequests(
        `Cuenta bloqueada temporalmente. Intenta nuevamente en ${blockStatus.remainingMinutes} minuto(s)`,
        null,
        retrySecs
      );
    }
  }

  /** @private */
  async _getUserForLogin(nationalId: string) {
    const user = await this.userRepository.findByUsernameAndNationalId(nationalId, 'login');
    if (!user) {
      throw AppError.badRequest('Credenciales invalidas');
    }
    if (!user.isActive) {
      throw AppError.forbidden('Cuenta inactiva o suspendida');
    }
    return user;
  }

  /** @private */
  // [RF-AUTH-02] | CA-05 | Segunda capa de rate limiting por cuenta (bonus, no exigido por CA-05)
  async _handleFailedLogin(user: UserWith<'login'>, nationalId: string, auditContext: RequestAuditContext, reason: string) {
    // Registrar el intento en BD para auditoría (sin blocked_until — el bloqueo lo gestiona Redis)
    await this.userLoginAttemptRepository.recordAttempt({
      userId: user.userId,
      usernameAttempt: user.authUsername ?? user.username, // columna NOT NULL; auth_username es nullable
      nationalId: nationalId,
      ipAddress: auditContext.ip,
      userAgent: auditContext.userAgent,
      deviceFingerprint: auditContext.fingerprintHash,
      success: false,
      failureReason: reason
      // attempted_at lo pone recordAttempt
    });

    // Incrementar contador Redis y verificar si se superó el límite
    const blockSecs = await LoginRateLimiter.incrementAccountFailures(nationalId);
    const MAX = LOGIN_RATE_LIMIT.ACCOUNT_MAX_ATTEMPTS;

    // Eventos forenses de seguridad (Opción A): LOGIN_FAILED y ACCOUNT_BLOCKED se mantienen
    // a propósito pese al log genérico que el middleware emite al propagar el throw. El intento
    // queda además persistido en user_login_attempts. No son duplicación a corregir.
    await audit.record('LOGIN_FAILED', {
      actorId: user.userId,
      details: {
        nationalId,
        reason,
        blocked: blockSecs !== null
      },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users',
      outcome: 'failure'
    });

    if (blockSecs !== null) {
      const minutes = Math.ceil(blockSecs / 60);
      await audit.record('ACCOUNT_BLOCKED', {
        actorId: user.userId,
        details: {
          nationalId,
          blockSecs,
          reason: `${MAX} intentos fallidos consecutivos`
        },
        entityId: user.userId,
        entityType: 'User',
        entityTable: 'users',
        outcome: 'failure'
      });

      // Notificar al usuario que su cuenta quedó bloqueada (fire-and-forget)
      this.notifier.notify({
        type: 'ACCOUNT_BLOCKED',
        userId: user.userId,
        metadata: {
          nombre: user.person?.firstName || 'Usuario',
          intentosFallidos: MAX,
          minutosBloqueo: minutes
        }
      }).catch(err => logger.warn('Error enviando notificación account blocked', { error: err.message }));

      throw AppError.tooManyRequests(
        `Cuenta bloqueada por ${minutes} minutos debido a múltiples intentos fallidos`,
        null,
        blockSecs
      );
    }

    throw AppError.badRequest('Contraseña incorrecta');
  }

  /**
   * Valida el token de reto MFA emitido en /auth/login antes de aceptar el segundo
   * factor. Garantiza que la contraseña ya se validó (paso 1) y que el reto pertenece
   * a este mismo usuario. Lanza 401 si el token es inválido, expiró o no corresponde.
   *
   * @private
   */
  async _assertMfaChallenge(session: string | null | undefined, userId: string) {
    if (!session) {
      throw AppError.unauthorized('Falta el token de reto MFA. Vuelve a iniciar sesión.');
    }
    const payload = await JwtUtil.verifyMfaChallengeToken(session);
    if (payload.userId !== userId) {
      throw AppError.unauthorized('El reto MFA no corresponde a este usuario. Vuelve a iniciar sesión.');
    }
  }

  /** @private */
  async _completeSuccessfulLogin(user: UserWith<'login'>, nationalId: string, auditContext: RequestAuditContext) {
    const { ip, userAgent, fingerprintHash } = auditContext;

    // ── Manejo de dispositivo (SÍNCRONO — puede bloquear el login si es PENDING) ──
    const deviceResult = await this.loginDevices.handleTrustedDevice(user, auditContext);

    // ── Una sesión por dispositivo + límite de sesiones simultáneas ──────────────
    // Cerrar la previa ANTES de contar el tope: una sesión abandonada del mismo
    // dispositivo no debe consumir cupo de los 5 ni empujar al cierre una sesión
    // real en otro dispositivo. Mismo orden que el login biométrico.
    await this.sessionControl.closePreviousDeviceSessions(user.userId, deviceResult.deviceId);
    await this.sessionControl.enforceSessionLimit(user.userId);

    // ── Limpiar invalidación global previa (logout-all) ──────────────────────────
    // Permite que el nuevo refresh token funcione correctamente en /auth/refresh.
    TokenBlacklistUtil.clearUserInvalidation(user.userId).catch(err =>
      logger.warn('Error limpiando invalidación de usuario en login', {
        error: err.message,
        userId: user.userId
      })
    );

    // ── Resetear contadores Redis de intentos fallidos ────────────────────────
    LoginRateLimiter.resetAccountCounters(nationalId).catch(err =>
      logger.warn('Error reseteando contadores de login en Redis', {
        error: err.message,
        userId: user.userId
      })
    );

    // ── Emitir tokens RS256 propios + sesión activa ──────────────────────────────
    const { sessionId, tokens } = await this.sessionIssuer.issue(user, {
      deviceId: deviceResult.deviceId,
      ip,
      userAgent,
      source: 'login'
    });

    // ── Registro push token (solo mobile, fire-and-forget) ───────────────────────
    // No bloquea el login — si falla, se loguea el error y se continúa
    const { pushToken, pushDeviceId, pushPlatform } = auditContext;

    if (pushToken && pushPlatform) {
      this._registrarPushToken(user.userId, pushToken, pushPlatform, pushDeviceId).catch(err =>
        logger.warn('Error registrando push token en login', {
          error: err.message,
          userId: user.userId
        })
      );
    }

    // ── Registro del intento exitoso ─────────────────────────
    await this.userLoginAttemptRepository.recordAttempt({
      userId: user.userId,
      usernameAttempt: user.authUsername ?? user.username, // columna NOT NULL; auth_username es nullable
      nationalId: nationalId,
      ipAddress: ip,
      userAgent: userAgent,
      deviceFingerprint: fingerprintHash,
      success: true,
      // Explícito: `POST /auth/login` es ruta pública y no pasa por AuthMiddleware.authenticate, así que
      // el AsyncLocalStorage no tiene el sessionId aunque la sesión ya se creó unas líneas más arriba.
      // Ata el intento exitoso a su sesión — es lo que `session_cache_key` prometía y nunca cumplió.
      originSessionId: sessionId
    });

    await audit.record('LOGIN_SUCCESS', {
      actorId: user.userId,
      details: {
        nationalId,
        fingerprintHash,
        deviceId: deviceResult.deviceId
      },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return LoginResponseDTO({
      user,
      tokens,
      deviceId: deviceResult.deviceId,
      // Solo mobile recibe el hmacSecret del dispositivo — lo guarda en el keychain
      // La web usa cookies httpOnly y no necesita HMAC
      deviceHmacSecret: auditContext.clientType === 'mobile' ? deviceResult.deviceHmacSecret : null
    });
  }

  /**
   * Registra o actualiza el push token del dispositivo móvil en SNS y BD.
   *
   * Lógica:
   *   - Si ya existe un registro con ese device_id → actualiza user_id + endpointArn
   *     (cubre el caso de un dispositivo compartido entre usuarios distintos)
   *   - Si no existe → crea un registro nuevo
   *
   * Siempre es fire-and-forget: los errores se loguean pero no afectan el login.
   *
   * @param {string}      userId      - ID del usuario que se está logueando
   * @param {string}      fcmToken    - Token FCM obtenido por la app móvil
   * @param {string}      platform    - 'android' | 'ios'
   * @param {string|null} deviceId    - ID único del dispositivo (opcional)
   * @private
   */
  async _registrarPushToken(userId: string, fcmToken: string, platform: string, deviceId: string | null = null) {
    try {
      const pushService = interopDefault(require('../../notification') as typeof import('../../notification')).pushNotificationService;
      const userPushTokenRepo = interopDefault(require('../../notification') as typeof import('../../notification')).userPushTokenRepository;

      // 1. Registrar en AWS SNS → devuelve el endpointArn
      //    Si el token FCM cambió, SNS lo actualiza internamente
      const endpointArn = await pushService.registrarDispositivo(fcmToken, platform, userId);
      if (!endpointArn) {
        // SNS no devolvió el endpoint: no hay nada que guardar (cae al catch de best-effort)
        throw new Error('SNS no devolvió EndpointArn');
      }

      // 2. Upsert en BD:
      //    - Busca por device_id primero, luego por token
      //    - Si encuentra → sobreescribe user_id (maneja cambio de usuario en mismo dispositivo)
      //    - Si no encuentra → crea nuevo registro
      await userPushTokenRepo.upsertToken(userId, endpointArn, platform, deviceId);

      logger.info('Push token registrado exitosamente en login', {
        userId,
        platform,
        deviceId: deviceId || 'sin device_id'
      });
    } catch (error) {
      // No relanzar — este error no debe interrumpir el login
      logger.warn('Error al registrar push token en login', {
        error: errorMessage(error),
        userId,
        platform,
        deviceId
      });
    }
  }

  // ============================================================
  // DELEGACIÓN (API pública estable para controllers y tests)
  // ============================================================
  // ── REFRESH TOKEN → TokenRefreshService ──

  refreshToken(refreshTokenStr: string) {
    return this.tokenRefresh.refreshToken(refreshTokenStr);
  }

  // ── LOGOUT → AuthLogoutService ──

  logout(userId: string, fingerprintHash: string, tokens = {}) {
    return this.logoutService.logout(userId, fingerprintHash, tokens);
  }

  logoutAll(userId: string, tokens = {}) {
    return this.logoutService.logoutAll(userId, tokens);
  }

  // ── TRUSTED DEVICES → TrustedDeviceManagementService ──

  getTrustedDevices(userId: string, currentFingerprintHash: string, currentSessionId: string | null = null) {
    return this.trustedDevices.getTrustedDevices(userId, currentFingerprintHash, currentSessionId);
  }

  getPendingDevices(userId: string) {
    return this.trustedDevices.getPendingDevices(userId);
  }

  renameDevice(userId: string, deviceId: string, deviceName: string) {
    return this.trustedDevices.renameDevice(userId, deviceId, deviceName);
  }

  blockDevice(userId: string, deviceId: string, currentFingerprintHash: string) {
    return this.trustedDevices.blockDevice(userId, deviceId, currentFingerprintHash);
  }

  unblockDevice(userId: string, deviceId: string, currentFingerprintHash: string) {
    return this.trustedDevices.unblockDevice(userId, deviceId, currentFingerprintHash);
  }

  approveDevice(userId: string, deviceId: string, currentFingerprintHash: string) {
    return this.trustedDevices.approveDevice(userId, deviceId, currentFingerprintHash);
  }

  // ── SESIONES → SessionControlService ──

  closeSessionById(userId: string, sessionId: string, currentSessionId: string | null) {
    return this.sessionControl.closeSessionById(userId, sessionId, currentSessionId);
  }

  closeOtherSessions(userId: string, currentSessionId: string | null) {
    return this.sessionControl.closeOtherSessions(userId, currentSessionId);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AuthLoginService {
  export interface LoginInput {
    nationalId: string;
    password: string;
    acceptPolicy?: boolean;
  }

  export interface VerifyMfaInput {
    nationalId: string;
    totpCode?: string;
    smsCode?: string;
    /** Token de reto MFA que devolvió /auth/login */
    session?: string;
    acceptPolicy?: boolean;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    userLoginAttemptRepository?: typeof userLoginAttemptRepository;
    verificationCodeRepository?: typeof verificationCodeRepository;
    userSessionRepository?: typeof userSessionRepository;
    trustedDeviceRepository?: typeof trustedDeviceRepository;
    privacyPolicyRepository?: typeof privacyPolicyRepository;
    consentRecorder?: typeof consentRecorder;
    notifier?: typeof notifier;
    SmsService?: typeof SmsService;
    tokenRefresh?: InstanceType<typeof TokenRefreshService>;
    logoutService?: InstanceType<typeof AuthLogoutService>;
    trustedDevices?: InstanceType<typeof TrustedDeviceManagementService>;
    sessionControl?: InstanceType<typeof SessionControlService>;
    loginDevices?: InstanceType<typeof LoginDeviceService>;
    smsChallenge?: InstanceType<typeof SmsLoginChallengeService>;
    policyGate?: InstanceType<typeof LoginPolicyGateService>;
    sessionIssuer?: InstanceType<typeof SessionIssuerService>;
  }
}

export default Object.assign(new AuthLoginService(), { AuthLoginService });
