// tests/unit/modules/client/kyc/iam/services/auth-biometric.service.test.ts
//
// AuthBiometricService — registro y login biométrico (WebAuthn-like, ES256). Es un servicio grande;
// cubrimos las ramas principales:
//   - registerStart: dispositivo no confiable (403), credencial ya existe (409), camino feliz.
//   - registerFinish: challenge inválido/ajeno/tipo incorrecto, firma inválida (401), credentialId
//     duplicado (409), camino feliz + notificación (setImmediate).
//   - loginStart: usuario inexistente (401), inactivo (403), camino feliz.
//   - _verifyLoginChallenge: challenge inválido/ajeno/tipo, replay por sign_count, firma inválida, ok.
//   - loginFinish: credencial no encontrada (401), usuario no encontrado (401)/inactivo (403),
//     política pendiente (devuelve DTO), dispositivo ya no confiable (403), camino feliz (tokens).
//   - _checkPrivacyPolicy: rol interno, sin política activa, versión al día, aceptación en un paso,
//     versión desactualizada (bloqueo).
//   - getCredentials / deleteCredential.
//   - _verifySignature: verificación ES256 REAL con crypto (DER y raw r||s, PEM, firma inválida).
//
// Los repos, utils de token, DTOs, logger y constantes se mockean; crypto es el real. Métodos
// privados se ejercen sobre el singleton exportado (spy/llamada directa) para aislar cada rama.

import { mocked, Loose, fixture } from 'tests/helpers/mock';
import crypto from 'node:crypto';

jest.mock('../repositories/user.repository', () => ({
  findByUserId: jest.fn(),
  findByUsernameAndNationalId: jest.fn(),
  updatePrivacyPolicy: jest.fn()
}));

jest.mock('../../audit/repositories/user-login-attempt.repository', () => ({
  recordAttempt: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../repositories/auth-trusted-device.repository', () => ({
  findByFingerprint: jest.fn(),
  findById: jest.fn(),
  updateLastSeen: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../legal/repositories/privacy-policy.repository', () => ({
  findActive: jest.fn()
}));

jest.mock('../../legal/repositories/user-consent.repository', () => ({
  grant: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../legal/repositories/consent-type.repository', () => ({
  findByCode: jest.fn()
}));

jest.mock('../repositories/biometric.repository', () => ({
  biometricCredentialRepository: {
    findByUserAndDevice: jest.fn(),
    findByCredentialId: jest.fn(),
    findAllByUser: jest.fn(),
    findByIdAndUser: jest.fn(),
    create: jest.fn(),
    deactivate: jest.fn().mockResolvedValue(undefined),
    updateAfterLogin: jest.fn().mockResolvedValue(undefined)
  },
  biometricChallengeRepository: {
    create: jest.fn().mockResolvedValue(undefined),
    findValid: jest.fn(),
    markAsUsed: jest.fn().mockResolvedValue(true)
  }
}));

jest.mock('../../../shared/infrastructure/security/jwt.util', () => ({
  generateAccessToken: jest.fn().mockResolvedValue('access-token'),
  generateRefreshToken: jest.fn().mockResolvedValue('refresh-token')
}));

jest.mock('../utils/refresh-token-store.util', () => ({
  save: jest.fn().mockResolvedValue(true),
  revoke: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../utils/token-blacklist.util', () => ({
  blacklistSession: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../repositories/user-session.repository', () => ({
  create: jest.fn().mockResolvedValue(undefined),
  findActiveByUserAndDevice: jest.fn().mockResolvedValue([]),
  countActive: jest.fn().mockResolvedValue(0),
  findOldestActive: jest.fn(),
  closeSession: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../../../shared/infrastructure/config', () => ({
  INTERNAL_ROLE_NAMES: ['admin', 'ejecutivo'],
  notifications: { ses: { logoUrl: 'https://logo.test/x.png' } },
  SECURITY: { MAX_ACTIVE_SESSIONS: 3 },
  jwt: { accessTokenExpiry: 900 },
  CONSENT_TYPE_CODES: { PRIVACY_POLICY: 'PRIVACY_POLICY' }
}));

// DTOs a passthrough.
jest.mock('../responses/auth-biometric.response', () => ({
  BiometricRegisterStartDTO: jest.fn(x => ({ dto: 'registerStart', ...x })),
  BiometricRegisterFinishDTO: jest.fn(c => ({ dto: 'registerFinish', ...c })),
  BiometricLoginStartDTO: jest.fn(x => ({ dto: 'loginStart', ...x })),
  BiometricCredentialListDTO: jest.fn(list => ({ credentials: list, total: list.length }))
}));

jest.mock('../responses/auth-login.response', () => ({
  LoginResponseDTO: jest.fn(x => ({ dto: 'login', ...x })),
  PolicyUpdateRequiredDTO: jest.fn(x => ({ dto: 'policyUpdate', ...x }))
}));

import userRepositoryModule from '../repositories/user.repository';
const userRepository = mocked(userRepositoryModule);
import userLoginAttemptRepositoryModule from '../../audit/repositories/user-login-attempt.repository';
const userLoginAttemptRepository = mocked(userLoginAttemptRepositoryModule);
import trustedDeviceRepositoryModule from '../repositories/auth-trusted-device.repository';
const trustedDeviceRepository = mocked(trustedDeviceRepositoryModule);
import privacyPolicyRepositoryModule from '../../legal/repositories/privacy-policy.repository';
const privacyPolicyRepository = mocked(privacyPolicyRepositoryModule);
import userConsentRepositoryModule from '../../legal/repositories/user-consent.repository';
const userConsentRepository = mocked(userConsentRepositoryModule);
import consentTypeRepositoryModule from '../../legal/repositories/consent-type.repository';
const consentTypeRepository = mocked(consentTypeRepositoryModule);
import biometricRepositoryModuleModule from '../repositories/biometric.repository';
const biometricRepositoryModule = mocked(biometricRepositoryModuleModule);
const {
  biometricCredentialRepository,
  biometricChallengeRepository
} = mocked(biometricRepositoryModule);
import JwtUtilModule from '../../../shared/infrastructure/security/jwt.util';
const JwtUtil = mocked(JwtUtilModule);
import RefreshTokenStoreModule from '../utils/refresh-token-store.util';
const RefreshTokenStore = mocked(RefreshTokenStoreModule);
import userSessionRepositoryModule from '../repositories/user-session.repository';
const userSessionRepository = mocked(userSessionRepositoryModule);
import NotificationUtilModule from '../../notification/notify';
const notifier = mocked(NotificationUtilModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;

import service from './auth-biometric.service';

const USER_ID = 'user-1';
const FP_HASH = 'fp-hash-1';
const DEVICE_ID = 'device-1';

// Vacía la cola de macrotareas (setImmediate del envío de notificación).
const flush = () => new Promise(resolve => { setImmediate(resolve); });

const trustedDevice = (overrides = {}) => ({
  userTrustedDeviceId: DEVICE_ID,
  status: 'trusted',
  fingerprintHash: FP_HASH,
  hmacSecret: 'hmac-1',
  ...overrides
});

describe('AuthBiometricService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userSessionRepository.findActiveByUserAndDevice.mockResolvedValue([]);
    userSessionRepository.countActive.mockResolvedValue(0);
  });

  // ============================================================
  // registerStart
  // ============================================================
  describe('registerStart', () => {
    it('lanza 403 si el dispositivo no es de confianza', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(null);

      await expect(service.registerStart(USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 403 });
      expect(biometricChallengeRepository.create).not.toHaveBeenCalled();
    });

    it('lanza 409 si el dispositivo ya tiene una credencial', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricCredentialRepository.findByUserAndDevice.mockResolvedValue({ userBiometricCredentialId: 'c-1' });

      await expect(service.registerStart(USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 409 });
    });

    it('genera challenge, lo persiste, audita y devuelve el DTO', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricCredentialRepository.findByUserAndDevice.mockResolvedValue(null);

      const result = await service.registerStart(USER_ID, FP_HASH);

      expect(biometricChallengeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, type: 'registration', challenge: expect.any(String) })
      );
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_REGISTER_START', expect.objectContaining({ actorId: USER_ID }));
      expect(result).toMatchObject({ dto: 'registerStart', deviceId: DEVICE_ID, algorithm: -7 });
    });
  });

  // ============================================================
  // registerFinish
  // ============================================================
  describe('registerFinish', () => {
    const payload = { credentialId: 'cred-1', publicKey: 'pk', challenge: 'ch', signature: 'sig' };

    it('lanza 403 si el dispositivo no es de confianza', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice({ status: 'pending' }));

      await expect(service.registerFinish(payload, USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lanza 400 si el challenge es inválido/expirado', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricChallengeRepository.findValid.mockResolvedValue(null);

      await expect(service.registerFinish(payload, USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza 403 si el challenge pertenece a otro usuario', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'chid', userId: 'otro', type: 'registration' });

      await expect(service.registerFinish(payload, USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lanza 400 si el tipo de challenge es incorrecto', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'chid', userId: USER_ID, type: 'authentication' });

      await expect(service.registerFinish(payload, USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza 400 sin verificar la firma si otro request ya consumió el challenge (replay)', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'chid', userId: USER_ID, type: 'registration' });
      biometricChallengeRepository.markAsUsed.mockResolvedValueOnce(false);
      const spy = jest.spyOn(service, '_verifySignature');

      await expect(service.registerFinish(payload, USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 400 });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('lanza 401 y audita si la firma es inválida (tras marcar el challenge usado)', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'chid', userId: USER_ID, type: 'registration' });
      const spy = jest.spyOn(service, '_verifySignature').mockReturnValue(false);

      await expect(service.registerFinish(payload, USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 401 });
      expect(biometricChallengeRepository.markAsUsed).toHaveBeenCalledWith('chid');
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_REGISTER_INVALID_SIGNATURE', expect.objectContaining({ actorId: USER_ID, outcome: 'failure' })
      );
      spy.mockRestore();
    });

    it('lanza 409 si el credentialId ya está registrado', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'chid', userId: USER_ID, type: 'registration' });
      const spy = jest.spyOn(service, '_verifySignature').mockReturnValue(true);
      biometricCredentialRepository.findByCredentialId.mockResolvedValue({ userBiometricCredentialId: 'dup' });

      await expect(service.registerFinish(payload, USER_ID, FP_HASH)).rejects.toMatchObject({ statusCode: 409 });
      spy.mockRestore();
    });

    it('camino feliz: guarda credencial, audita, dispara notificación y devuelve DTO', async () => {
      trustedDeviceRepository.findByFingerprint.mockResolvedValue(trustedDevice());
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'chid', userId: USER_ID, type: 'registration' });
      const spy = jest.spyOn(service, '_verifySignature').mockReturnValue(true);
      biometricCredentialRepository.findByCredentialId.mockResolvedValue(null);
      biometricCredentialRepository.create.mockResolvedValue({ userBiometricCredentialId: 'newcred', credentialId: 'cred-1' });
      userRepository.findByUserId.mockResolvedValue({ person: { firstName: 'Ana' } });

      const result = await service.registerFinish(payload, USER_ID, FP_HASH);

      expect(biometricCredentialRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, credentialId: 'cred-1', signCount: 0 })
      );
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_REGISTER_SUCCESS', expect.objectContaining({ actorId: USER_ID }));
      expect(result).toMatchObject({ dto: 'registerFinish', userBiometricCredentialId: 'newcred' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BIOMETRIC_CREDENTIAL_REGISTERED',
          userId: USER_ID,
          // Regresión (fase 4 TS): antes se pasaba el id suelto y la entidad relacionada no se guardaba
          relatedEntity: { type: 'BiometricCredential', id: 'newcred' }
        })
      );
      spy.mockRestore();
    });
  });

  // ============================================================
  // loginStart
  // ============================================================
  describe('loginStart', () => {
    it('lanza 401 si el usuario no existe', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue(null);

      await expect(service.loginStart({ nationalId: '111' })).rejects.toMatchObject({ statusCode: 401 });
    });

    it('lanza 403 si la cuenta está inactiva', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue({ userId: USER_ID, isActive: false });

      await expect(service.loginStart({ nationalId: '111' })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('camino feliz: crea challenge de authentication, audita y devuelve DTO', async () => {
      userRepository.findByUsernameAndNationalId.mockResolvedValue({ userId: USER_ID, isActive: true });

      const result = await service.loginStart({ nationalId: '111' });

      expect(biometricChallengeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, type: 'authentication' })
      );
      expect(result).toMatchObject({ dto: 'loginStart', userId: USER_ID });
    });
  });

  // ============================================================
  // _verifyLoginChallenge
  // ============================================================
  describe('_verifyLoginChallenge', () => {
    const base = {
      credential: { publicKey: 'pk', signCount: 5 },
      challenge: 'ch',
      signature: 'sig',
      signCount: 6,
      userId: USER_ID,
      credentialId: 'cred-1'
    };

    it('lanza 400 si el challenge es inválido', async () => {
      biometricChallengeRepository.findValid.mockResolvedValue(null);
      await expect(service._verifyLoginChallenge(fixture(base))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza 403 si el challenge es de otro usuario', async () => {
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'x', userId: 'otro', type: 'authentication' });
      await expect(service._verifyLoginChallenge(fixture(base))).rejects.toMatchObject({ statusCode: 403 });
    });

    it('lanza 400 si el tipo de challenge es incorrecto', async () => {
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'x', userId: USER_ID, type: 'registration' });
      await expect(service._verifyLoginChallenge(fixture(base))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza 401 (replay) si signCount no supera el guardado y audita', async () => {
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'x', userId: USER_ID, type: 'authentication' });

      await expect(service._verifyLoginChallenge(fixture({ ...base, signCount: 5 }))).rejects.toMatchObject({ statusCode: 401 });
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_LOGIN_REPLAY_ATTACK', expect.objectContaining({ actorId: USER_ID, outcome: 'failure' }));
    });

    it('lanza 401 si la firma es inválida y audita', async () => {
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'x', userId: USER_ID, type: 'authentication' });
      const spy = jest.spyOn(service, '_verifySignature').mockReturnValue(false);

      await expect(service._verifyLoginChallenge(fixture(base))).rejects.toMatchObject({ statusCode: 401 });
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_LOGIN_INVALID_SIGNATURE', expect.objectContaining({ actorId: USER_ID, outcome: 'failure' }));
      spy.mockRestore();
    });

    it('resuelve sin error cuando todo es válido', async () => {
      biometricChallengeRepository.findValid.mockResolvedValue({ biometricChallengeId: 'x', userId: USER_ID, type: 'authentication' });
      const spy = jest.spyOn(service, '_verifySignature').mockReturnValue(true);

      await expect(service._verifyLoginChallenge(fixture(base))).resolves.toBeUndefined();
      expect(biometricChallengeRepository.markAsUsed).toHaveBeenCalledWith('x');
      spy.mockRestore();
    });
  });

  // ============================================================
  // loginFinish
  // ============================================================
  describe('loginFinish', () => {
    const auditContext = { ip: '1.2.3.4', userAgent: 'jest', fingerprintHash: FP_HASH };

    it('lanza 401 si no encuentra la credencial', async () => {
      biometricCredentialRepository.findByCredentialId.mockResolvedValue(null);

      await expect(
        service.loginFinish({ credentialId: 'x', challenge: 'c', signature: 's', signCount: 1 }, auditContext)
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('lanza 401 si el usuario no existe tras validar el challenge', async () => {
      biometricCredentialRepository.findByCredentialId.mockResolvedValue({ userId: USER_ID, userTrustedDeviceId: DEVICE_ID });
      const vspy = jest.spyOn(service, '_verifyLoginChallenge').mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(null);

      await expect(
        service.loginFinish({ credentialId: 'cred-1', challenge: 'c', signature: 's', signCount: 1 }, auditContext)
      ).rejects.toMatchObject({ statusCode: 401 });
      vspy.mockRestore();
    });

    it('lanza 403 si el usuario está inactivo', async () => {
      biometricCredentialRepository.findByCredentialId.mockResolvedValue({ userId: USER_ID, userTrustedDeviceId: DEVICE_ID });
      const vspy = jest.spyOn(service, '_verifyLoginChallenge').mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue({ userId: USER_ID, isActive: false });

      await expect(
        service.loginFinish({ credentialId: 'cred-1', challenge: 'c', signature: 's', signCount: 1 }, auditContext)
      ).rejects.toMatchObject({ statusCode: 403 });
      vspy.mockRestore();
    });

    it('devuelve el DTO de política cuando _checkPrivacyPolicy la exige', async () => {
      biometricCredentialRepository.findByCredentialId.mockResolvedValue({ userId: USER_ID, userTrustedDeviceId: DEVICE_ID });
      const vspy = jest.spyOn(service, '_verifyLoginChallenge').mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue({ userId: USER_ID, isActive: true });
      const pspy = jest.spyOn(service, '_checkPrivacyPolicy').mockResolvedValue(fixture({ dto: 'policyUpdate' }));

      const result = await service.loginFinish(
        { credentialId: 'cred-1', challenge: 'c', signature: 's', signCount: 1 },
        auditContext
      );

      expect(result).toEqual({ dto: 'policyUpdate' });
      expect(JwtUtil.generateAccessToken).not.toHaveBeenCalled();
      vspy.mockRestore();
      pspy.mockRestore();
    });

    it('lanza 403 si el dispositivo de la credencial ya no es de confianza', async () => {
      biometricCredentialRepository.findByCredentialId.mockResolvedValue({ userId: USER_ID, userTrustedDeviceId: DEVICE_ID });
      const vspy = jest.spyOn(service, '_verifyLoginChallenge').mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue({ userId: USER_ID, isActive: true });
      const pspy = jest.spyOn(service, '_checkPrivacyPolicy').mockResolvedValue(null);
      trustedDeviceRepository.findById.mockResolvedValue(null);

      await expect(
        service.loginFinish({ credentialId: 'cred-1', challenge: 'c', signature: 's', signCount: 1 }, auditContext)
      ).rejects.toMatchObject({ statusCode: 403 });
      vspy.mockRestore();
      pspy.mockRestore();
    });

    it('camino feliz: emite tokens, actualiza sign_count/last_seen, registra intento y devuelve LoginResponseDTO', async () => {
      biometricCredentialRepository.findByCredentialId.mockResolvedValue({ userId: USER_ID, userTrustedDeviceId: DEVICE_ID });
      const vspy = jest.spyOn(service, '_verifyLoginChallenge').mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue({ userId: USER_ID, isActive: true, authUsername: 'ana', username: '111' });
      const pspy = jest.spyOn(service, '_checkPrivacyPolicy').mockResolvedValue(null);
      trustedDeviceRepository.findById.mockResolvedValue(trustedDevice());

      const result = await service.loginFinish(
        { credentialId: 'cred-1', challenge: 'c', signature: 's', signCount: 7 },
        auditContext
      );

      expect(JwtUtil.generateAccessToken).toHaveBeenCalled();
      expect(JwtUtil.generateRefreshToken).toHaveBeenCalled();
      expect(RefreshTokenStore.save).toHaveBeenCalled();
      expect(biometricCredentialRepository.updateAfterLogin).toHaveBeenCalledWith('cred-1', 7);
      expect(trustedDeviceRepository.updateLastSeen).toHaveBeenCalledWith(USER_ID, FP_HASH);
      expect(userLoginAttemptRepository.recordAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, success: true, originSessionId: expect.any(String) })
      );
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_LOGIN_SUCCESS', expect.objectContaining({ actorId: USER_ID }));
      expect(result).toMatchObject({ dto: 'login', deviceId: DEVICE_ID, deviceHmacSecret: 'hmac-1' });
      vspy.mockRestore();
      pspy.mockRestore();
    });

    // La política de sesiones vive en SessionControlService (compartida con el login por contraseña)
    describe('política de sesiones', () => {
      const arrangeHappyPath = (svc: Loose) => {
        biometricCredentialRepository.findByCredentialId.mockResolvedValue({ userId: USER_ID, userTrustedDeviceId: DEVICE_ID });
        jest.spyOn(svc, '_verifyLoginChallenge').mockResolvedValue(undefined);
        jest.spyOn(svc, '_checkPrivacyPolicy').mockResolvedValue(null);
        userRepository.findByUserId.mockResolvedValue({ userId: USER_ID, isActive: true, authUsername: 'ana', username: '111' });
        trustedDeviceRepository.findById.mockResolvedValue(trustedDevice());
      };

      afterEach(() => jest.restoreAllMocks());

      it('delega en el sessionControl inyectado antes de emitir tokens', async () => {
        const sessionControl = {
          closePreviousDeviceSessions: jest.fn().mockResolvedValue(undefined),
          enforceSessionLimit: jest.fn().mockResolvedValue(undefined)
        };
        const svc = new service.AuthBiometricService(fixture({ sessionControl }));
        arrangeHappyPath(svc);

        await svc.loginFinish({ credentialId: 'cred-1', challenge: 'c', signature: 's', signCount: 7 }, auditContext);

        expect(sessionControl.closePreviousDeviceSessions).toHaveBeenCalledWith(USER_ID, DEVICE_ID);
        expect(sessionControl.enforceSessionLimit).toHaveBeenCalledWith(USER_ID);
        expect(sessionControl.enforceSessionLimit.mock.invocationCallOrder[0]).toBeLessThan(
          fixture(JwtUtil.generateAccessToken.mock.invocationCallOrder[0])
        );
      });

      it('con el SessionControlService real cierra la sesión más antigua al alcanzar el límite', async () => {
        arrangeHappyPath(service);
        userSessionRepository.countActive.mockResolvedValue(3); // SECURITY.MAX_ACTIVE_SESSIONS = 3 en el mock
        userSessionRepository.findOldestActive.mockResolvedValue({ userSessionId: 'old-1', jti: 'jti-old' });

        await service.loginFinish({ credentialId: 'cred-1', challenge: 'c', signature: 's', signCount: 7 }, auditContext);

        expect(userSessionRepository.closeSession).toHaveBeenCalledWith('old-1', 'session_limit');
        expect(RefreshTokenStore.revoke).toHaveBeenCalledWith('jti-old');
        expect(logAudit).toHaveBeenCalledWith('SESSION_LIMIT_ENFORCED', expect.objectContaining({ actorId: USER_ID }));
      });
    });
  });

  // ============================================================
  // _checkPrivacyPolicy
  // ============================================================
  describe('_checkPrivacyPolicy', () => {
    it('devuelve null para usuarios internos (no sujetos a la política de clientes)', async () => {
      privacyPolicyRepository.findActive.mockResolvedValue({ version: 2 });
      const user = { userId: USER_ID, role: { name: 'admin' }, privacyPolicyVersion: 1 };

      await expect(service._checkPrivacyPolicy(fixture(user), false, '1.2.3.4')).resolves.toBeNull();
      expect(userRepository.updatePrivacyPolicy).not.toHaveBeenCalled();
    });

    it('devuelve null si no hay política activa', async () => {
      privacyPolicyRepository.findActive.mockResolvedValue(null);
      const user = { userId: USER_ID, role: { name: 'client' }, privacyPolicyVersion: 1 };

      await expect(service._checkPrivacyPolicy(fixture(user), false, null)).resolves.toBeNull();
    });

    it('devuelve null si el usuario ya está en la versión activa', async () => {
      privacyPolicyRepository.findActive.mockResolvedValue({ version: 3 });
      const user = { userId: USER_ID, role: { name: 'client' }, privacyPolicyVersion: 3 };

      await expect(service._checkPrivacyPolicy(fixture(user), false, null)).resolves.toBeNull();
    });

    it('con acceptPolicy=true actualiza la versión, registra consent y audita (devuelve null)', async () => {
      privacyPolicyRepository.findActive.mockResolvedValue({ version: 3, privacyPolicyId: 'pp-3' });
      consentTypeRepository.findByCode.mockResolvedValue({ consentTypeId: 'ct-1' });
      const user = { userId: USER_ID, role: { name: 'client' }, privacyPolicyVersion: 2 };

      const result = await service._checkPrivacyPolicy(fixture(user), true, '1.2.3.4');

      expect(userRepository.updatePrivacyPolicy).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ version: 3 }));
      expect(logAudit).toHaveBeenCalledWith('PRIVACY_POLICY_ACCEPTED', expect.objectContaining({ actorId: USER_ID }));
      expect(result).toBeNull();

      await flush();
      expect(userConsentRepository.grant).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, consentTypeId: 'ct-1', privacyPolicyId: 'pp-3' })
      );
    });

    it('con versión desactualizada y sin aceptar bloquea y devuelve PolicyUpdateRequiredDTO', async () => {
      privacyPolicyRepository.findActive.mockResolvedValue({
        version: 4,
        documentUrl: 'http://x',
        summary: 's',
        effectiveDate: '2026-01-01'
      });
      const user = { userId: USER_ID, role: { name: 'client' }, privacyPolicyVersion: 2 };

      const result = await service._checkPrivacyPolicy(fixture(user), false, null);

      expect(result).toMatchObject({ dto: 'policyUpdate', newVersion: 4 });
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_LOGIN_BLOCKED_POLICY_UPDATE', expect.objectContaining({ actorId: USER_ID, outcome: 'failure' })
      );
    });
  });

  // ============================================================
  // getCredentials / deleteCredential
  // ============================================================
  describe('getCredentials', () => {
    it('devuelve la lista y audita el conteo', async () => {
      biometricCredentialRepository.findAllByUser.mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }]);

      const result = await service.getCredentials(USER_ID);

      expect(result).toEqual({ credentials: [{ id: 'c-1' }, { id: 'c-2' }], total: 2 });
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_CREDENTIALS_VIEWED', expect.objectContaining({ actorId: USER_ID, details: { count: 2 } }));
    });
  });

  describe('deleteCredential', () => {
    it('lanza 404 si la credencial no pertenece al usuario', async () => {
      biometricCredentialRepository.findByIdAndUser.mockResolvedValue(null);

      await expect(service.deleteCredential(USER_ID, 'c-1')).rejects.toMatchObject({ statusCode: 404 });
      expect(biometricCredentialRepository.deactivate).not.toHaveBeenCalled();
    });

    it('desactiva la credencial y audita', async () => {
      biometricCredentialRepository.findByIdAndUser.mockResolvedValue({ userBiometricCredentialId: 'c-1' });

      const result = await service.deleteCredential(USER_ID, 'c-1');

      expect(biometricCredentialRepository.deactivate).toHaveBeenCalledWith('c-1');
      expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_CREDENTIAL_DELETED', expect.objectContaining({ actorId: USER_ID }));
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // _verifySignature — verificación ES256 REAL con crypto
  // ============================================================
  describe('_verifySignature (ES256 real)', () => {
    const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const challengeBuffer = crypto.randomBytes(32);
    const challenge = challengeBuffer.toString('base64url');

    const pubDerBase64 = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const pubPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });

    it('verifica una firma DER válida con la llave pública en base64 (DER)', () => {
      const signer = crypto.createSign('SHA256');
      signer.update(challengeBuffer);
      const signature = signer.sign(keyPair.privateKey).toString('base64url');

      expect(service._verifySignature({ publicKey: pubDerBase64, challenge, signature })).toBe(true);
    });

    it('verifica una firma raw (r||s, 64 bytes) convirtiéndola a DER', () => {
      const rawSig = crypto.sign('sha256', challengeBuffer, { key: keyPair.privateKey, dsaEncoding: 'ieee-p1363' });
      const signature = rawSig.toString('base64url');

      expect(rawSig.length).toBe(64);
      expect(service._verifySignature({ publicKey: pubDerBase64, challenge, signature })).toBe(true);
    });

    it('acepta la llave pública ya en formato PEM', () => {
      const signer = crypto.createSign('SHA256');
      signer.update(challengeBuffer);
      const signature = signer.sign(keyPair.privateKey).toString('base64url');

      expect(service._verifySignature(fixture({ publicKey: pubPem, challenge, signature }))).toBe(true);
    });

    it('devuelve false ante una firma que no corresponde', () => {
      const signer = crypto.createSign('SHA256');
      signer.update(Buffer.from('otro-mensaje'));
      const signature = signer.sign(keyPair.privateKey).toString('base64url');

      expect(service._verifySignature({ publicKey: pubDerBase64, challenge, signature })).toBe(false);
    });

    it('devuelve false (sin lanzar) ante datos corruptos', () => {
      expect(service._verifySignature({ publicKey: 'no-es-una-llave', challenge, signature: 'xxxx' })).toBe(false);
    });
  });
});
