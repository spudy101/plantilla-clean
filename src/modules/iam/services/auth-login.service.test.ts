// tests/unit/modules/shared-endpoints/kyc/iam/services/auth-login.service.test.ts
//
// AuthLoginService — orquestador del login/MFA/sesiones/dispositivos de confianza. Es un service
// grande (~1637 líneas): aquí cubrimos sus RAMAS PRINCIPALES aislando por completo el acceso a datos
// y la criptografía. Se prueban:
//   - login(): bloqueo de cuenta (429), credenciales inválidas (404/400), password incorrecta (400/429),
//     política de privacidad desactualizada, reto TOTP, reto SMS y camino feliz sin MFA.
//   - verifyMFA(): TOTP válido/ inválido y verificación por SMS.
//   - refreshToken(): ventana de gracia, blacklist, invalidación global, reuse attack y rotación feliz.
//   - logout()/logoutAll(): blacklist + cierre de sesiones + auditoría.
//   - Trusted devices: getTrustedDevices/getPendingDevices/renameDevice/blockDevice/unblockDevice/approveDevice.
//   - closeSessionById()/closeOtherSessions().
//
// Se usa el AppError REAL para assertar statusCode. Los DTOs se hacen passthrough para no acoplar a su
// forma. Los envíos de SMS y notificaciones diferidos en setImmediate se drenan con `flush`
// (helper de cuerpo de bloque por la regla eslint no-promise-executor-return).

// ── Repositorios ────────────────────────────────────────────────────────────
jest.mock('../repositories/user.repository', () => ({
  verifyPassword: jest.fn(),
  findByUsernameAndNationalId: jest.fn(),
  findWithPrimaryPhone: jest.fn(),
  findByIdWithRole: jest.fn(),
  updatePrivacyPolicy: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../audit/infrastructure/persistence/prisma-user-login-attempt.repository', () => ({
  recordAttempt: jest.fn().mockResolvedValue(undefined),
  checkIfBlocked: jest.fn()
}));

jest.mock('../../notification/repositories/verification-code.repository', () => ({
  secondsUntilNewCode: jest.fn(),
  create: jest.fn(),
  findActiveByContact: jest.fn(),
  incrementAttempts: jest.fn().mockResolvedValue(undefined),
  markAsVerified: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../repositories/user-session.repository', () => ({
  create: jest.fn().mockResolvedValue(undefined),
  updateJtiAndLastAccess: jest.fn().mockResolvedValue(undefined),
  findById: jest.fn(),
  closeSession: jest.fn().mockResolvedValue(undefined),
  closeAllByUser: jest.fn().mockResolvedValue(undefined),
  findActiveByUserExcept: jest.fn(),
  closeAllByUserExcept: jest.fn().mockResolvedValue(undefined),
  findActiveByUserAndDevice: jest.fn(),
  countActive: jest.fn(),
  findOldestActive: jest.fn()
}));

jest.mock('../repositories/auth-trusted-device.repository', () => ({
  updateLastSeen: jest.fn().mockResolvedValue(undefined),
  deleteAllByUser: jest.fn().mockResolvedValue(undefined),
  findAllByUserWithSessions: jest.fn(),
  findAllPending: jest.fn(),
  findByIdAndUser: jest.fn(),
  rename: jest.fn(),
  findByFingerprint: jest.fn(),
  block: jest.fn(),
  unblock: jest.fn(),
  approve: jest.fn(),
  countTrusted: jest.fn(),
  create: jest.fn()
}));

jest.mock('../../legal/infrastructure/persistence/prisma-privacy-policy.repository', () => ({
  findActive: jest.fn()
}));

jest.mock('../../legal/infrastructure/persistence/prisma-user-consent.repository', () => ({
  grant: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../legal/infrastructure/persistence/prisma-consent-type.repository', () => ({
  findActiveByCode: jest.fn().mockResolvedValue(null)
}));

// ── Utils cripto / tokens ────────────────────────────────────────────────────
jest.mock('../../../shared/infrastructure/security/jwt.util', () => ({
  generateMfaChallengeToken: jest.fn().mockResolvedValue('challenge-token'),
  verifyMfaChallengeToken: jest.fn(),
  verifyRefreshToken: jest.fn(),
  generateAccessToken: jest.fn().mockResolvedValue('access-token'),
  generateRefreshToken: jest.fn().mockResolvedValue('refresh-token')
}));

jest.mock('../../../shared/infrastructure/security/totp.util', () => ({
  verify: jest.fn()
}));

jest.mock('../../../shared/infrastructure/security/encryption.util', () => ({
  decrypt: jest.fn().mockReturnValue('totp-secret')
}));

jest.mock('../utils/refresh-token-store.util', () => ({
  getRotation: jest.fn(),
  exists: jest.fn(),
  revoke: jest.fn().mockResolvedValue(undefined),
  save: jest.fn(),
  saveRotation: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/security/device-fingerprint.util', () => ({
  enrichDevice: jest.fn().mockReturnValue({
    browser: 'Chrome',
    os: 'Windows',
    deviceType: 'desktop',
    city: 'Santiago',
    country: 'Chile',
    countryCode: 'CL',
    deviceName: 'Chrome en Windows'
  })
}));

jest.mock('../utils/device-blocklist.util', () => ({
  block: jest.fn().mockResolvedValue(undefined),
  unblock: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../utils/token-blacklist.util', () => ({
  isRefreshTokenBlacklisted: jest.fn(),
  isUserSessionsInvalidated: jest.fn(),
  blacklistRefreshToken: jest.fn().mockResolvedValue(undefined),
  invalidateSessionTokensOnRotation: jest.fn().mockResolvedValue(undefined),
  invalidateUserSessions: jest.fn().mockResolvedValue(undefined),
  blacklistAccessToken: jest.fn().mockResolvedValue(undefined),
  blacklistSession: jest.fn().mockResolvedValue(undefined),
  clearUserInvalidation: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/cache/redis.util', () => ({
  isAvailable: jest.fn().mockReturnValue(true)
}));

jest.mock('../utils/login-rate-limiter.util', () => ({
  checkAccountBlock: jest.fn(),
  incrementAccountFailures: jest.fn(),
  resetAccountCounters: jest.fn().mockResolvedValue(undefined)
}));

// ── Notificaciones / SMS ─────────────────────────────────────────────────────
jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../notification/services/sms.service', () => ({
  resolveE164: jest.fn().mockResolvedValue('+56911112222'),
  enviarSmsOtp: jest.fn().mockResolvedValue({ success: true })
}));

// ── Logger ───────────────────────────────────────────────────────────────────
jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));

// ── Constantes (el módulo real valida .env y hace process.exit) ──────────────
jest.mock('../../../shared/infrastructure/config', () => ({
  LOGIN_RATE_LIMIT: { ACCOUNT_MAX_ATTEMPTS: 5 },
  SECURITY: {
    ABSOLUTE_SESSION_LIFETIME_HOURS: 8,
    MAX_ACTIVE_SESSIONS: 5,
    REFRESH_ROTATION_GRACE_SECONDS: 60
  },
  AUTH_ERROR_CODES: {
    SESSION_CLOSED: 'SESSION_CLOSED',
    SESSION_COMPROMISED: 'SESSION_COMPROMISED',
    SESSION_ABSOLUTE_LIFETIME: 'SESSION_ABSOLUTE_LIFETIME'
  },
  server: { nodeEnv: 'test' },
  notifications: { ses: { logoUrl: 'http://logo' } },
  CLIENT_ACCESS_ROLES: ['CLIENTE'],
  INTERNAL_ROLE_NAMES: ['SUPERADMIN', 'ADMIN', 'AUDITOR'],
  MOCKS: { EXTERNAL_PROVIDERS: false },
  jwt: { accessTokenExpiry: 3600 },
  CONSENT_TYPE_CODES: { PRIVACY_POLICY: 'PRIVACY_POLICY' }
}));

// ── DTOs passthrough ─────────────────────────────────────────────────────────
jest.mock('../responses/auth-login.response', () => ({
  LoginResponseDTO: (arg: Loose) => ({ __dto: 'login', ...arg }),
  PolicyUpdateRequiredDTO: (arg: Loose) => ({ __dto: 'policy', ...arg }),
  MFARequiredResponseDTO: (arg: Loose) => ({ __dto: 'mfa', ...arg }),
  TrustedDeviceListDTO: (devices: Loose, fh: Loose, sid: Loose) => ({ devices, total: devices.length, fh, sid }),
  TrustedDeviceUpdateDTO: (device: Loose) => ({
    userTrustedDeviceId: device.userTrustedDeviceId,
    deviceName: device.deviceName,
    status: device.status,
    updatedAt: device.updatedAt
  })
}));

// ── requires DESPUÉS de los mocks ────────────────────────────────────────────
import { mocked, Loose } from 'tests/helpers/mock';
import userRepositoryModule from '../repositories/user.repository';
const userRepository = mocked(userRepositoryModule);
const userLoginAttemptRepositoryModule = jest.requireMock<import('../../audit/infrastructure/persistence/prisma-user-login-attempt.repository').PrismaUserLoginAttemptRepository>('../../audit/infrastructure/persistence/prisma-user-login-attempt.repository');
const userLoginAttemptRepository = mocked(userLoginAttemptRepositoryModule);
import verificationCodeRepositoryModule from '../../notification/repositories/verification-code.repository';
const verificationCodeRepository = mocked(verificationCodeRepositoryModule);
import userSessionRepositoryModule from '../repositories/user-session.repository';
const userSessionRepository = mocked(userSessionRepositoryModule);
import trustedDeviceRepositoryModule from '../repositories/auth-trusted-device.repository';
const trustedDeviceRepository = mocked(trustedDeviceRepositoryModule);
const privacyPolicyRepositoryModule = jest.requireMock<import('../../legal/infrastructure/persistence/prisma-privacy-policy.repository').PrismaPrivacyPolicyRepository>('../../legal/infrastructure/persistence/prisma-privacy-policy.repository');
const privacyPolicyRepository = mocked(privacyPolicyRepositoryModule);
import JwtUtilModule from '../../../shared/infrastructure/security/jwt.util';
const JwtUtil = mocked(JwtUtilModule);
import TotpUtilModule from '../../../shared/infrastructure/security/totp.util';
const TotpUtil = mocked(TotpUtilModule);
import RefreshTokenStoreModule from '../utils/refresh-token-store.util';
const RefreshTokenStore = mocked(RefreshTokenStoreModule);
import DeviceBlocklistUtilModule from '../utils/device-blocklist.util';
const DeviceBlocklistUtil = mocked(DeviceBlocklistUtilModule);
import TokenBlacklistUtilModule from '../utils/token-blacklist.util';
const TokenBlacklistUtil = mocked(TokenBlacklistUtilModule);
import redisClientModule from '../../../shared/infrastructure/cache/redis.util';
const redisClient = mocked(redisClientModule);
import NotificationUtilModule from '../../notification/notify';
const notifier = mocked(NotificationUtilModule);
import SmsServiceModule from '../../notification/services/sms.service';
const SmsService = mocked(SmsServiceModule);
import LoginRateLimiterModule from '../utils/login-rate-limiter.util';
const LoginRateLimiter = mocked(LoginRateLimiterModule);
import auditServiceModule from '../../audit/infrastructure/legacy/audit-recorder';
const logAudit = mocked(auditServiceModule).record;

import service from './auth-login.service';

// ── Helpers ──────────────────────────────────────────────────────────────────
const flush = () => new Promise(resolve => { setImmediate(resolve); });

const AUDIT = { ip: '1.2.3.4', userAgent: 'jest', fingerprintHash: 'fp-1' };

function makeUser(overrides = {}) {
  return {
    userId: 'u-1',
    authUsername: 'juan',
    isActive: true,
    passwordHash: 'hash',
    preferredMfaMethod: 'none',
    privacyPolicyVersion: null,
    totpSecret: 'enc-secret',
    role: { name: 'CLIENTE' },
    person: { firstName: 'Juan', contact: { email: 'j@x.cl' } },
    ...overrides
  };
}

function trustedDevice(overrides = {}) {
  return {
    userTrustedDeviceId: 'dev-1',
    status: 'trusted',
    hmacSecret: 'hmac-1',
    fingerprintHash: 'fp-1',
    deviceName: 'Chrome',
    ...overrides
  };
}

describe('AuthLoginService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Defaults del camino feliz (se sobrescriben por test cuando aplica).
    LoginRateLimiter.checkAccountBlock.mockResolvedValue(null);
    LoginRateLimiter.incrementAccountFailures.mockResolvedValue(null);
    LoginRateLimiter.resetAccountCounters.mockResolvedValue(undefined);
    userLoginAttemptRepository.checkIfBlocked.mockResolvedValue(null);
    userLoginAttemptRepository.recordAttempt.mockResolvedValue(undefined);
    userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser());
    userRepository.findWithPrimaryPhone.mockResolvedValue(makeUser());
    userRepository.findByIdWithRole.mockResolvedValue(makeUser());
    userRepository.verifyPassword.mockResolvedValue(true);
    privacyPolicyRepository.findActive.mockResolvedValue(null);
    trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
    trustedDeviceRepository.updateLastSeen.mockResolvedValue(undefined);
    userSessionRepository.findActiveByUserAndDevice.mockResolvedValue([]);
    userSessionRepository.countActive.mockResolvedValue(0);
    userSessionRepository.create.mockResolvedValue(undefined);
    RefreshTokenStore.save.mockResolvedValue(true);
    TokenBlacklistUtil.clearUserInvalidation.mockResolvedValue(undefined);
  });

  // ============================================================
  // LOGIN
  // ============================================================
  describe('login', () => {
    it('lanza 429 si la cuenta está bloqueada en Redis', async () => {
      LoginRateLimiter.checkAccountBlock.mockResolvedValue(120);
      await expect(service.login({ nationalId: '111', password: 'pw' }, AUDIT)).rejects.toMatchObject({
        statusCode: 429
      });
    });

    it('lanza 400 (credenciales inválidas) si el usuario no existe', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(null);
      await expect(service.login({ nationalId: '111', password: 'pw' }, AUDIT)).rejects.toMatchObject({
        statusCode: 400
      });
    });

    it('lanza 403 si la cuenta está inactiva', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ isActive: false }));
      await expect(service.login({ nationalId: '111', password: 'pw' }, AUDIT)).rejects.toMatchObject({
        statusCode: 403
      });
    });

    it('lanza 403 si el rol no tiene acceso al portal (serverContext)', async () => {
      const audit = { ...AUDIT, serverContext: 'admin' }; // CLIENTE no accede al portal admin
      await expect(service.login({ nationalId: '111', password: 'pw' }, audit)).rejects.toMatchObject({
        statusCode: 403
      });
    });

    it('con password incorrecta registra el intento y lanza 400', async () => {
      userRepository.verifyPassword.mockResolvedValue(false);
      LoginRateLimiter.incrementAccountFailures.mockResolvedValue(null);

      await expect(service.login({ nationalId: '111', password: 'bad' }, AUDIT)).rejects.toMatchObject({
        statusCode: 400
      });
      expect(userLoginAttemptRepository.recordAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
      expect(logAudit).toHaveBeenCalledWith('LOGIN_FAILED', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('con password incorrecta que supera el tope lanza 429 y notifica el bloqueo', async () => {
      userRepository.verifyPassword.mockResolvedValue(false);
      LoginRateLimiter.incrementAccountFailures.mockResolvedValue(600);

      await expect(service.login({ nationalId: '111', password: 'bad' }, AUDIT)).rejects.toMatchObject({
        statusCode: 429
      });
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ACCOUNT_BLOCKED' })
      );
      expect(logAudit).toHaveBeenCalledWith('ACCOUNT_BLOCKED', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('devuelve PolicyUpdateRequiredDTO si la política está desactualizada y no se aceptó', async () => {
      privacyPolicyRepository.findActive.mockResolvedValue({
        version: 'v2',
        document_url: 'http://p',
        summary: 's',
        effective_date: '2026-01-01'
      });
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ privacyPolicyVersion: 'v1' }));

      const result = await service.login({ nationalId: '111', password: 'pw' }, AUDIT);
      expect(result).toMatchObject({ __dto: 'policy', newVersion: 'v2' });
      // No debe validar la contraseña: el flujo corta antes.
      expect(userRepository.verifyPassword).not.toHaveBeenCalled();
    });

    it('emite reto TOTP (MFARequiredResponseDTO) si el usuario prefiere totp', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'totp' }));

      const result = await service.login({ nationalId: '111', password: 'pw' }, AUDIT);
      expect(result).toMatchObject({
        __dto: 'mfa',
        challengeType: 'SOFTWARE_TOKEN_MFA',
        session: 'challenge-token',
        preferredMfaMethod: 'totp'
      });
      expect(JwtUtil.generateMfaChallengeToken).toHaveBeenCalledWith('u-1');
    });

    it('emite reto SMS y agenda el envío por SNS si el usuario prefiere sms', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'sms' }));
      userRepository.findWithPrimaryPhone.mockResolvedValue({
        person: { contact: { phonePrimary: '911112222', phonePrimaryPrefixId: 'pref-1' } }
      });
      verificationCodeRepository.secondsUntilNewCode.mockResolvedValue(0);
      verificationCodeRepository.create.mockResolvedValue({ verificationCodeId: 'vc-1' });

      const result = await service.login({ nationalId: '111', password: 'pw' }, AUDIT);
      expect(result).toMatchObject({ __dto: 'mfa', challengeType: 'SMS_OTP', session: 'vc-1' });

      await flush();
      expect(SmsService.resolveE164).toHaveBeenCalledWith('911112222', 'pref-1');
      expect(SmsService.enviarSmsOtp).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'mfa_login' })
      );
    });

    it('lanza 429 en el reto SMS si aún no puede pedir un nuevo código', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'sms' }));
      userRepository.findWithPrimaryPhone.mockResolvedValue({
        person: { contact: { phonePrimary: '911112222', phonePrimaryPrefixId: 'pref-1' } }
      });
      verificationCodeRepository.secondsUntilNewCode.mockResolvedValue(42);

      await expect(service.login({ nationalId: '111', password: 'pw' }, AUDIT)).rejects.toMatchObject({
        statusCode: 429,
        retryable: true,
        retryAfter: 42
      });
    });

    it('camino feliz sin MFA: emite tokens, crea sesión y devuelve LoginResponseDTO', async () => {
      const result: Loose = await service.login({ nationalId: '111', password: 'pw' }, AUDIT);

      expect(result).toMatchObject({ __dto: 'login' });
      expect(result.tokens).toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });
      expect(userSessionRepository.create).toHaveBeenCalled();
      expect(RefreshTokenStore.save).toHaveBeenCalled();
      expect(userLoginAttemptRepository.recordAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
      expect(logAudit).toHaveBeenCalledWith('LOGIN_SUCCESS', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('lanza 403 si el dispositivo existente está bloqueado', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ status: 'blocked' }));
      await expect(service.login({ nationalId: '111', password: 'pw' }, AUDIT)).rejects.toMatchObject({
        statusCode: 403
      });
    });
  });

  // ============================================================
  // VERIFY MFA
  // ============================================================
  describe('verifyMFA', () => {
    it('con TOTP válido completa el login', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'totp' }));
      JwtUtil.verifyMfaChallengeToken.mockResolvedValue({ userId: 'u-1' });
      TotpUtil.verify.mockReturnValue(true);

      const result: Loose = await service.verifyMFA(
        { nationalId: '111', totpCode: '123456', session: 'challenge-token' },
        AUDIT
      );
      expect(result).toMatchObject({ __dto: 'login' });
      expect(result.tokens.accessToken).toBe('access-token');
    });

    it('con TOTP inválido registra el intento y lanza 400', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'totp' }));
      JwtUtil.verifyMfaChallengeToken.mockResolvedValue({ userId: 'u-1' });
      TotpUtil.verify.mockReturnValue(false);

      await expect(
        service.verifyMFA({ nationalId: '111', totpCode: '000000', session: 'challenge-token' }, AUDIT)
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(userLoginAttemptRepository.recordAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ failureReason: 'Codigo TOTP incorrecto' })
      );
      expect(logAudit).toHaveBeenCalledWith('MFA_FAILED', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('lanza 401 si falta el token de reto MFA (session)', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'totp' }));
      await expect(service.verifyMFA({ nationalId: '111', totpCode: '123456' }, AUDIT)).rejects.toMatchObject({
        statusCode: 401
      });
    });

    it('con SMS correcto marca verificado y completa el login', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'sms' }));
      userRepository.findWithPrimaryPhone.mockResolvedValue({
        person: { contact: { phonePrimary: '911112222' } }
      });
      verificationCodeRepository.findActiveByContact.mockResolvedValue({
        verificationCodeId: 'vc-1',
        attempts: 0,
        code: '123456',
        verifiedAt: null
      });

      const result: Loose = await service.verifyMFA(
        { nationalId: '111', smsCode: '123456' },
        AUDIT
      );
      expect(verificationCodeRepository.markAsVerified).toHaveBeenCalledWith('vc-1');
      expect(result).toMatchObject({ __dto: 'login' });
    });

    it('con SMS incorrecto incrementa intentos y lanza 400', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(makeUser({ preferredMfaMethod: 'sms' }));
      userRepository.findWithPrimaryPhone.mockResolvedValue({
        person: { contact: { phonePrimary: '911112222' } }
      });
      verificationCodeRepository.findActiveByContact.mockResolvedValue({
        verificationCodeId: 'vc-1',
        attempts: 1,
        code: '123456',
        verifiedAt: null
      });

      await expect(
        service.verifyMFA({ nationalId: '111', smsCode: '000000' }, AUDIT)
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(verificationCodeRepository.incrementAttempts).toHaveBeenCalledWith('vc-1');
    });
  });

  // ============================================================
  // REFRESH TOKEN
  // ============================================================
  describe('refreshToken', () => {
    const DECODED = { jti: 'jti-1', userId: 'u-1', iat: 1000, sessionId: 'sess-1' };

    it('reusa el par emitido si el JTI está en la ventana de gracia', async () => {
      JwtUtil.verifyRefreshToken.mockResolvedValue(DECODED);
      RefreshTokenStore.getRotation.mockResolvedValue({
        accessToken: 'grace-a',
        refreshToken: 'grace-r',
        expiresIn: 3600
      });

      const result = await service.refreshToken('tok');
      expect(result).toMatchObject({ accessToken: 'grace-a', refreshToken: 'grace-r' });
      // Se corta temprano — no verifica blacklist.
      expect(TokenBlacklistUtil.isRefreshTokenBlacklisted).not.toHaveBeenCalled();
    });

    it('lanza 401 (SESSION_CLOSED) si el refresh token está en blacklist', async () => {
      JwtUtil.verifyRefreshToken.mockResolvedValue(DECODED);
      RefreshTokenStore.getRotation.mockResolvedValue(null);
      TokenBlacklistUtil.isRefreshTokenBlacklisted.mockResolvedValue(true);

      // BUG del fuente: AppError.unauthorized(message, details) NO acepta `code`, así que el
      // AUTH_ERROR_CODE viaja en `.details.code` y `.code` queda en 'UNAUTHORIZED'.
      await expect(service.refreshToken('tok')).rejects.toMatchObject({
        statusCode: 401,
        details: { code: 'SESSION_CLOSED' }
      });
    });

    it('detecta reuse attack e invalida todas las sesiones (401 SESSION_COMPROMISED)', async () => {
      JwtUtil.verifyRefreshToken.mockResolvedValue(DECODED);
      RefreshTokenStore.getRotation.mockResolvedValue(null);
      TokenBlacklistUtil.isRefreshTokenBlacklisted.mockResolvedValue(false);
      TokenBlacklistUtil.isUserSessionsInvalidated.mockResolvedValue(false);
      RefreshTokenStore.exists.mockResolvedValue(null); // JTI ausente
      redisClient.isAvailable.mockReturnValue(true);
      userSessionRepository.findById.mockResolvedValue({ status: 'active' });

      await expect(service.refreshToken('tok')).rejects.toMatchObject({
        statusCode: 401,
        details: { code: 'SESSION_COMPROMISED' }
      });
      expect(TokenBlacklistUtil.invalidateUserSessions).toHaveBeenCalledWith('u-1');
      expect(logAudit).toHaveBeenCalledWith('REFRESH_TOKEN_REUSE_ATTACK', expect.objectContaining({ actorId: 'u-1' })
      );
    });

    it('rotación feliz: revoca el JTI viejo y emite tokens nuevos', async () => {
      JwtUtil.verifyRefreshToken.mockResolvedValue(DECODED);
      RefreshTokenStore.getRotation.mockResolvedValue(null);
      TokenBlacklistUtil.isRefreshTokenBlacklisted.mockResolvedValue(false);
      TokenBlacklistUtil.isUserSessionsInvalidated.mockResolvedValue(false);
      RefreshTokenStore.exists.mockResolvedValue('u-1');
      userRepository.findByIdWithRole.mockResolvedValue(makeUser());
      // Sesión activa dentro del tope absoluto.
      userSessionRepository.findById.mockResolvedValue({
        status: 'active',
        startedAt: new Date().toISOString()
      });
      RefreshTokenStore.save.mockResolvedValue(true);

      const result = await service.refreshToken('tok');

      expect(RefreshTokenStore.revoke).toHaveBeenCalledWith('jti-1');
      expect(result).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600
      });
      expect(logAudit).toHaveBeenCalledWith('TOKEN_REFRESHED', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('lanza 401 si el usuario ya no existe o está inactivo', async () => {
      JwtUtil.verifyRefreshToken.mockResolvedValue(DECODED);
      RefreshTokenStore.getRotation.mockResolvedValue(null);
      TokenBlacklistUtil.isRefreshTokenBlacklisted.mockResolvedValue(false);
      TokenBlacklistUtil.isUserSessionsInvalidated.mockResolvedValue(false);
      RefreshTokenStore.exists.mockResolvedValue('u-1');
      userRepository.findByIdWithRole.mockResolvedValue(null);

      await expect(service.refreshToken('tok')).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  // ============================================================
  // LOGOUT
  // ============================================================
  describe('logout', () => {
    it('cierra la sesión, blacklistea tokens y audita LOGOUT', async () => {
      const result = await service.logout('u-1', 'fp-1', {
        accessToken: 'a',
        tokenExp: 999,
        refreshToken: 'r',
        sessionId: 'sess-1'
      });

      expect(userSessionRepository.closeSession).toHaveBeenCalledWith('sess-1', 'logout');
      expect(TokenBlacklistUtil.blacklistAccessToken).toHaveBeenCalledWith('a', 999);
      expect(TokenBlacklistUtil.blacklistRefreshToken).toHaveBeenCalledWith('r');
      expect(logAudit).toHaveBeenCalledWith('LOGOUT', expect.objectContaining({ actorId: 'u-1' }));
      expect(result).toBeNull();
    });
  });

  describe('logoutAll', () => {
    it('invalida todas las sesiones, las cierra en BD y notifica (setImmediate)', async () => {
      const result = await service.logoutAll('u-1', { accessToken: 'a', tokenExp: 999, firstName: 'Juan' });

      expect(TokenBlacklistUtil.invalidateUserSessions).toHaveBeenCalledWith('u-1');
      expect(userSessionRepository.closeAllByUser).toHaveBeenCalledWith('u-1', 'logout_all');
      expect(trustedDeviceRepository.deleteAllByUser).toHaveBeenCalledWith('u-1');
      expect(logAudit).toHaveBeenCalledWith('LOGOUT_ALL', expect.objectContaining({ actorId: 'u-1' }));
      expect(result).toBeNull();

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LOGOUT_ALL' })
      );
    });
  });

  // ============================================================
  // TRUSTED DEVICES
  // ============================================================
  describe('getTrustedDevices / getPendingDevices', () => {
    it('lista dispositivos con sesiones y audita', async () => {
      trustedDeviceRepository.findAllByUserWithSessions.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await service.getTrustedDevices('u-1', 'fp-1', 'sess-1');
      expect(result).toMatchObject({ total: 2 });
      expect(logAudit).toHaveBeenCalledWith('TRUSTED_DEVICES_VIEWED', expect.objectContaining({ actorId: 'u-1' }));
    });

    it('lista dispositivos pendientes y audita', async () => {
      trustedDeviceRepository.findAllPending.mockResolvedValue([{ id: 1 }]);
      const result = await service.getPendingDevices('u-1');
      expect(result).toMatchObject({ total: 1 });
      expect(logAudit).toHaveBeenCalledWith('PENDING_DEVICES_VIEWED', expect.objectContaining({ actorId: 'u-1' }));
    });
  });

  describe('renameDevice', () => {
    it('lanza 404 si el dispositivo no existe', async () => {
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(null);
      await expect(service.renameDevice('u-1', 'dev-1', 'Nuevo')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('renombra y audita', async () => {
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(trustedDevice());
      trustedDeviceRepository.rename.mockResolvedValue(trustedDevice({ deviceName: 'Nuevo' }));
      const result = await service.renameDevice('u-1', 'dev-1', 'Nuevo');
      expect(result).toMatchObject({ deviceName: 'Nuevo' });
      expect(logAudit).toHaveBeenCalledWith('TRUSTED_DEVICE_RENAMED', expect.objectContaining({ actorId: 'u-1' }));
    });
  });

  describe('blockDevice', () => {
    it('lanza 403 si quien bloquea no es un dispositivo de confianza', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ status: 'pending' }));
      await expect(service.blockDevice('u-1', 'dev-2', 'fp-1')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lanza 400 si intentas bloquear tu propio dispositivo', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-1' }));
      await expect(service.blockDevice('u-1', 'dev-1', 'fp-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza 400 si es el único dispositivo de confianza', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-1' }));
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(
        trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'trusted' })
      );
      trustedDeviceRepository.countTrusted.mockResolvedValue(1);
      await expect(service.blockDevice('u-1', 'dev-2', 'fp-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('bloquea, escribe la blocklist en Redis y audita', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-1' }));
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(
        trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'pending', fingerprintHash: 'fp-2' })
      );
      trustedDeviceRepository.block.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'blocked' }));

      const result = await service.blockDevice('u-1', 'dev-2', 'fp-1');
      expect(DeviceBlocklistUtil.block).toHaveBeenCalledWith('u-1', 'fp-2');
      expect(result).toMatchObject({ status: 'blocked' });
      expect(logAudit).toHaveBeenCalledWith('TRUSTED_DEVICE_BLOCKED', expect.objectContaining({ actorId: 'u-1' }));
    });
  });

  describe('unblockDevice', () => {
    it('lanza 400 si el dispositivo no está bloqueado', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-1' }));
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(
        trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'pending' })
      );
      await expect(service.unblockDevice('u-1', 'dev-2', 'fp-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('desbloquea (→ pending), limpia Redis y audita', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-1' }));
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(
        trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'blocked', fingerprintHash: 'fp-2' })
      );
      trustedDeviceRepository.unblock.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'pending' }));

      const result = await service.unblockDevice('u-1', 'dev-2', 'fp-1');
      expect(DeviceBlocklistUtil.unblock).toHaveBeenCalledWith('u-1', 'fp-2');
      expect(result).toMatchObject({ status: 'pending' });
      expect(logAudit).toHaveBeenCalledWith('TRUSTED_DEVICE_UNBLOCKED', expect.objectContaining({ actorId: 'u-1' }));
    });
  });

  describe('approveDevice', () => {
    it('lanza 400 si el dispositivo no está pendiente', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-1' }));
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(
        trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'trusted' })
      );
      await expect(service.approveDevice('u-1', 'dev-2', 'fp-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('aprueba (→ trusted) y audita', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-1' }));
      trustedDeviceRepository.findByIdAndUser.mockResolvedValue(
        trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'pending' })
      );
      trustedDeviceRepository.approve.mockResolvedValue(trustedDevice({ userTrustedDeviceId: 'dev-2', status: 'trusted' }));

      const result = await service.approveDevice('u-1', 'dev-2', 'fp-1');
      expect(result).toMatchObject({ status: 'trusted' });
      expect(logAudit).toHaveBeenCalledWith('TRUSTED_DEVICE_APPROVED', expect.objectContaining({ actorId: 'u-1' }));
    });
  });

  // ============================================================
  // CIERRE SELECTIVO DE SESIONES
  // ============================================================
  describe('closeSessionById', () => {
    it('lanza 400 si se intenta cerrar la sesión actual', async () => {
      await expect(service.closeSessionById('u-1', 'sess-1', 'sess-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza 404 si la sesión no existe o no pertenece al usuario', async () => {
      userSessionRepository.findById.mockResolvedValue(null);
      await expect(service.closeSessionById('u-1', 'sess-2', 'sess-1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lanza 400 si la sesión ya está cerrada', async () => {
      userSessionRepository.findById.mockResolvedValue({ userId: 'u-1', status: 'closed', jti: 'j' });
      await expect(service.closeSessionById('u-1', 'sess-2', 'sess-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('cierra la sesión, revoca el JTI y blacklistea', async () => {
      userSessionRepository.findById.mockResolvedValue({ userId: 'u-1', status: 'active', jti: 'j-2' });
      const result = await service.closeSessionById('u-1', 'sess-2', 'sess-1');

      expect(userSessionRepository.closeSession).toHaveBeenCalledWith('sess-2', 'closed_by_user');
      expect(RefreshTokenStore.revoke).toHaveBeenCalledWith('j-2');
      expect(TokenBlacklistUtil.blacklistSession).toHaveBeenCalledWith('sess-2');
      expect(result).toMatchObject({ sessionId: 'sess-2', status: 'closed' });
    });
  });

  describe('closeOtherSessions', () => {
    it('devuelve closedCount 0 si no hay otras sesiones', async () => {
      userSessionRepository.findActiveByUserExcept.mockResolvedValue([]);
      const result = await service.closeOtherSessions('u-1', 'sess-1');
      expect(result).toMatchObject({ closedCount: 0 });
      expect(userSessionRepository.closeAllByUserExcept).not.toHaveBeenCalled();
    });

    it('cierra las demás sesiones, revoca cada JTI y devuelve el conteo', async () => {
      userSessionRepository.findActiveByUserExcept.mockResolvedValue([
        { userSessionId: 's-2', jti: 'j-2' },
        { userSessionId: 's-3', jti: 'j-3' }
      ]);
      const result = await service.closeOtherSessions('u-1', 'sess-1');

      expect(userSessionRepository.closeAllByUserExcept).toHaveBeenCalledWith('u-1', 'sess-1', 'logout_others');
      expect(RefreshTokenStore.revoke).toHaveBeenCalledWith('j-2');
      expect(RefreshTokenStore.revoke).toHaveBeenCalledWith('j-3');
      expect(result).toMatchObject({ closedCount: 2 });
    });
  });
});
