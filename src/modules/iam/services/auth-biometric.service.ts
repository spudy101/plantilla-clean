import type { UserWith } from '../repositories/user.repository';
import type { UserBiometricCredential } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { RequestAuditContext } from '../../../shared/application/audit-context';
import crypto from 'node:crypto';

import userRepository from '../repositories/user.repository';
import auditModule from '../../audit';
const { userLoginAttemptRepository, audit } = auditModule;
import trustedDeviceRepository from '../repositories/auth-trusted-device.repository';
import legalModule from '../../legal';
const { privacyPolicyRepository, consentRecorder } = legalModule;
import biometricRepositoryModule from '../repositories/biometric.repository';
const {
  biometricCredentialRepository,
  biometricChallengeRepository
} = biometricRepositoryModule;
import userSessionRepository from '../repositories/user-session.repository';
import SessionControlService from './auth-login/session-control.service';
import SessionIssuerService from './auth-login/session-issuer.service';
import LoginPolicyGateService from './auth-login/login-policy-gate.service';
import es256SignatureUtilModule from '../../../shared/infrastructure/security/es256-signature.util';
const { verifyEs256Signature } = es256SignatureUtilModule;
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import authBiometricDtoModule from '../responses/auth-biometric.response';
const {
  BiometricRegisterStartDTO,
  BiometricRegisterFinishDTO,
  BiometricLoginStartDTO,
  BiometricCredentialListDTO
} = authBiometricDtoModule;
import authLoginDtoModule from '../responses/auth-login.response';
const { LoginResponseDTO } = authLoginDtoModule;
// ============================================================
// CONSTANTES
// ============================================================

// ES256 = ECDSA con P-256 y SHA-256
const SUPPORTED_ALGORITHM = -7;

const CHALLENGE_BYTES = 32; // bytes para crypto.randomBytes

class AuthBiometricService {
  userRepository: typeof userRepository;
  userLoginAttemptRepository: typeof userLoginAttemptRepository;
  trustedDeviceRepository: typeof trustedDeviceRepository;
  privacyPolicyRepository: typeof privacyPolicyRepository;
  consentRecorder: typeof consentRecorder;
  biometricCredentialRepository: typeof biometricCredentialRepository;
  biometricChallengeRepository: typeof biometricChallengeRepository;
  userSessionRepository: typeof userSessionRepository;
  verifySignature: typeof verifyEs256Signature;
  notifier: typeof notifier;
  sessionControl: InstanceType<typeof SessionControlService>;
  sessionIssuer: InstanceType<typeof SessionIssuerService>;
  policyGate: InstanceType<typeof LoginPolicyGateService>;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AuthBiometricService({ userRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: AuthBiometricService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.userLoginAttemptRepository = deps.userLoginAttemptRepository ?? userLoginAttemptRepository;
    this.trustedDeviceRepository = deps.trustedDeviceRepository ?? trustedDeviceRepository;
    this.privacyPolicyRepository = deps.privacyPolicyRepository ?? privacyPolicyRepository;
    this.consentRecorder = deps.consentRecorder ?? consentRecorder;
    this.biometricCredentialRepository = deps.biometricCredentialRepository ?? biometricCredentialRepository;
    this.biometricChallengeRepository = deps.biometricChallengeRepository ?? biometricChallengeRepository;
    this.userSessionRepository = deps.userSessionRepository ?? userSessionRepository;
    // Misma política de sesiones que el login por contraseña (una por dispositivo + límite simultáneo)
    this.sessionControl =
      deps.sessionControl ?? new SessionControlService({ userSessionRepository: this.userSessionRepository });
    this.sessionIssuer =
      deps.sessionIssuer ?? new SessionIssuerService({ userSessionRepository: this.userSessionRepository });
    this.policyGate =
      deps.policyGate ??
      new LoginPolicyGateService({
        userRepository: this.userRepository,
        privacyPolicyRepository: this.privacyPolicyRepository,
        consentRecorder: this.consentRecorder
      });
    this.verifySignature = deps.verifySignature ?? verifyEs256Signature;
    this.notifier = deps.notifier ?? notifier;
  }

  // ============================================================
  // REGISTER
  // ============================================================

  /**
   * Genera un challenge para el registro de huella.
   * Solo desde dispositivos TRUSTED.
   *
   * @returns {Promise<BiometricRegisterStartDTO>}
   */
  async registerStart(userId: string, fingerprintHash: string) {
    // Verificar que el dispositivo actual es TRUSTED
    const device = await this.trustedDeviceRepository.findByFingerprint(userId, fingerprintHash);
    if (!device || device.status !== 'trusted') {
      throw AppError.forbidden('Solo puedes registrar una huella desde un dispositivo de confianza');
    }

    // Verificar que el dispositivo no tiene ya una credencial activa
    const existing = await this.biometricCredentialRepository.findByUserAndDevice(userId, device.userTrustedDeviceId);
    if (existing) {
      throw AppError.conflict('Este dispositivo ya tiene una huella registrada. Elimínala primero.');
    }

    const challenge = crypto.randomBytes(CHALLENGE_BYTES).toString('base64url');

    await this.biometricChallengeRepository.create({
      userId: userId,
      challenge,
      type: 'registration'
    });

    await audit.record('BIOMETRIC_REGISTER_START', {
      actorId: userId,
      entityId: device.userTrustedDeviceId,
      entityType: 'UserTrustedDevice',
      entityTable: 'user_trusted_devices'
    });

    return BiometricRegisterStartDTO({
      challenge,
      deviceId: device.userTrustedDeviceId,
      algorithm: SUPPORTED_ALGORITHM
    });
  }

  /**
   * Recibe la llave pública del dispositivo y registra la credencial.
   *
   * El dispositivo móvil debe enviar:
   *   - credentialId: string (base64url) — ID único generado por el dispositivo
   *   - publicKey:    string (base64url o PEM) — llave pública ES256
   *   - challenge:    string — el mismo challenge que recibió en registerStart
   *   - signature:    string (base64url) — firma del challenge con la llave privada
   *
   * @returns {Promise<BiometricRegisterFinishDTO>}
   */
  async registerFinish(
    { credentialId, publicKey, challenge, signature }: { credentialId: string; publicKey: string; challenge: string; signature: string },
    userId: string,
    fingerprintHash: string
  ) {
    // Verificar dispositivo TRUSTED
    const device = await this.trustedDeviceRepository.findByFingerprint(userId, fingerprintHash);
    if (!device || device.status !== 'trusted') {
      throw AppError.forbidden('Solo puedes registrar una huella desde un dispositivo de confianza');
    }

    // Verificar y consumir el challenge
    const challengeRecord = await this.biometricChallengeRepository.findValid(challenge);
    if (!challengeRecord) {
      throw AppError.badRequest('Challenge inválido, expirado o ya utilizado');
    }
    if (challengeRecord.userId !== userId) {
      throw AppError.forbidden('El challenge no pertenece a este usuario');
    }
    if (challengeRecord.type !== 'registration') {
      throw AppError.badRequest('Tipo de challenge incorrecto');
    }

    // Consumir ANTES de verificar y solo si sigue sin usar: si otro request lo usó primero, se rechaza (replay)
    if (!(await this.biometricChallengeRepository.markAsUsed(challengeRecord.biometricChallengeId))) {
      throw AppError.badRequest('Challenge inválido, expirado o ya utilizado');
    }

    // Verificar la firma ES256
    const isValid = this._verifySignature({ publicKey, challenge, signature });
    if (!isValid) {
      await audit.record('BIOMETRIC_REGISTER_INVALID_SIGNATURE', {
        actorId: userId,
        entityId: device.userTrustedDeviceId,
        entityType: 'UserTrustedDevice',
        entityTable: 'user_trusted_devices',
        outcome: 'failure'
      });
      throw AppError.unauthorized('Firma biométrica inválida');
    }

    // Verificar que el credentialId no esté ya registrado
    const existingCred = await this.biometricCredentialRepository.findByCredentialId(credentialId);
    if (existingCred) {
      throw AppError.conflict('Esta credencial biométrica ya está registrada');
    }

    // Guardar la credencial
    const credential = await this.biometricCredentialRepository.create({
      userId: userId,
      userTrustedDeviceId: device.userTrustedDeviceId,
      credentialId: credentialId,
      publicKey: publicKey,
      signCount: 0
    });

    await audit.record('BIOMETRIC_REGISTER_SUCCESS', {
      actorId: userId,
      details: {
        deviceId: device.userTrustedDeviceId
      },
      entityId: credential.userBiometricCredentialId,
      entityType: 'BiometricCredential',
      entityTable: 'biometric_credentials'
    });

    setImmediate(() => {
      this.userRepository
        .findByUserId(userId, 'basic')
        .then(user =>
          this.notifier.notify({
            type: 'BIOMETRIC_CREDENTIAL_REGISTERED',
            userId,
            // Antes se pasaba el id suelto (string) y la notificación no guardaba la entidad
            relatedEntity: { type: 'BiometricCredential', id: credential.userBiometricCredentialId },
            metadata: { nombre: user?.person?.firstName ?? 'Usuario', logoUrl: notifications.ses.logoUrl }
          })
        )
        .catch(err => logger.warn('Error enviando notificación biométrico registrado', { error: err.message }));
    });

    return BiometricRegisterFinishDTO(credential);
  }

  // ============================================================
  // LOGIN
  // ============================================================

  /**
   * Genera un challenge para el login biométrico.
   * Endpoint público — recibe nationalId para identificar al usuario.
   *
   * @returns {Promise<BiometricLoginStartDTO>}
   */
  async loginStart({ nationalId }: { nationalId: string }) {
    const user = await this.userRepository.findByUsernameAndNationalId(nationalId, 'login');
    if (!user) {
      throw AppError.unauthorized('Credenciales inválidas');
    }
    if (!user.isActive) {
      throw AppError.forbidden('Cuenta inactiva o suspendida');
    }

    const challenge = crypto.randomBytes(CHALLENGE_BYTES).toString('base64url');

    await this.biometricChallengeRepository.create({
      userId: user.userId,
      challenge,
      type: 'authentication'
    });

    await audit.record('BIOMETRIC_LOGIN_START', {
      actorId: user.userId,
      details: { nationalId },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return BiometricLoginStartDTO({ challenge, userId: user.userId });
  }

  /**
   * Verifica la firma del dispositivo y autentica al usuario.
   *
   * El dispositivo móvil debe enviar:
   *   - credentialId: string — el mismo que guardó al registrarse
   *   - challenge:    string — el challenge recibido en loginStart
   *   - signature:    string (base64url) — challenge firmado con la llave privada
   *   - signCount:    number — contador del authenticator (debe ser mayor al guardado)
   *
   * @returns {Promise<LoginResponseDTO>}
   */
  async loginFinish(
    { credentialId, challenge, signature, signCount }: { credentialId: string; challenge: string; signature: string; signCount: number },
    auditContext: RequestAuditContext
  ) {
    const { ip, userAgent, fingerprintHash } = auditContext;

    // Buscar la credencial
    const credential = await this.biometricCredentialRepository.findByCredentialId(credentialId);
    if (!credential) {
      throw AppError.unauthorized('Credencial biométrica no encontrada');
    }

    const { userId } = credential;

    // Verificar y consumir el challenge, sign_count y firma
    await this._verifyLoginChallenge({
      credential,
      challenge,
      signature,
      signCount,
      userId,
      credentialId
    });

    // Cargar usuario con las asociaciones que LoginResponseDTO necesita (mismo nivel que login normal)
    const user = await this.userRepository.findByUserId(userId, 'login');
    if (!user) {
      throw AppError.unauthorized('Usuario no encontrado');
    }
    if (!user.isActive) {
      throw AppError.forbidden('Cuenta inactiva o suspendida');
    }

    // Verificar política de privacidad — misma lógica que el login por contraseña
    const policyCheck = await this._checkPrivacyPolicy(user, auditContext.acceptPolicy === true, auditContext.ip);
    if (policyCheck) {
      return policyCheck;
    }

    // Verificar que el dispositivo de la credencial sigue siendo TRUSTED
    const device = await this.trustedDeviceRepository.findById(credential.userTrustedDeviceId);
    if (!device || device.status !== 'trusted') {
      throw AppError.forbidden('El dispositivo asociado a esta credencial ya no es de confianza');
    }

    // Una sesión por dispositivo + límite de sesiones simultáneas — igual que el login por contraseña
    await this.sessionControl.closePreviousDeviceSessions(userId, device.userTrustedDeviceId);
    await this.sessionControl.enforceSessionLimit(userId);

    // La firma ES256 verificada YA autenticó al usuario: la huella desbloqueó la llave
    // privada en el secure enclave del dispositivo. Emitimos tokens propios RS256 igual
    // que _completeSuccessfulLogin del login por contraseña — sin Cognito ni contraseña.
    const { sessionId, tokens } = await this.sessionIssuer.issue(user, {
      deviceId: device.userTrustedDeviceId,
      ip,
      userAgent,
      source: 'login biométrico'
    });

    // Actualizar sign_count, last_seen y registrar intento — en paralelo
    await Promise.all([
      this.biometricCredentialRepository.updateAfterLogin(credentialId, signCount),
      this.trustedDeviceRepository.updateLastSeen(userId, device.fingerprintHash),
      this.userLoginAttemptRepository.recordAttempt({
        userId: userId,
        usernameAttempt: user.authUsername ?? user.username, // columna NOT NULL; auth_username es nullable
        nationalId: user.username,
        ipAddress: ip,
        userAgent: userAgent,
        deviceFingerprint: fingerprintHash,
        success: true,
        // Explícito por lo mismo que en auth-login: la ruta de login biométrico es pública, el
        // AsyncLocalStorage no trae sessionId aunque la sesión ya exista en scope.
        originSessionId: sessionId
      })
    ]);

    await audit.record('BIOMETRIC_LOGIN_SUCCESS', {
      actorId: userId,
      details: {
        deviceId: device.userTrustedDeviceId
      },
      entityId: credentialId,
      entityType: 'BiometricCredential',
      entityTable: 'biometric_credentials'
    });

    return LoginResponseDTO({
      user,
      tokens,
      deviceId: device.userTrustedDeviceId,
      // El mobile necesita el hmacSecret para firmar requests posteriores
      deviceHmacSecret: device.hmacSecret || null
    });
  }

  /**
   * Verifica el challenge, el sign_count y la firma ES256 para el login biométrico.
   * Extrae la lógica de validación de loginFinish para mantener el método dentro del límite.
   * @private
   */
  async _verifyLoginChallenge({
    credential,
    challenge,
    signature,
    signCount,
    userId,
    credentialId
  }: {
    credential: UserBiometricCredential;
    challenge: string;
    signature: string;
    signCount: number;
    userId: string;
    credentialId: string;
  }) {
    // Verificar y consumir el challenge
    const challengeRecord = await this.biometricChallengeRepository.findValid(challenge);
    if (!challengeRecord) {
      throw AppError.badRequest('Challenge inválido, expirado o ya utilizado');
    }
    if (challengeRecord.userId !== userId) {
      throw AppError.forbidden('El challenge no pertenece a este usuario');
    }
    if (challengeRecord.type !== 'authentication') {
      throw AppError.badRequest('Tipo de challenge incorrecto');
    }

    // Consumir ANTES de verificar y solo si sigue sin usar: si otro request lo usó primero, se rechaza (replay)
    if (!(await this.biometricChallengeRepository.markAsUsed(challengeRecord.biometricChallengeId))) {
      throw AppError.badRequest('Challenge inválido, expirado o ya utilizado');
    }

    // Verificar sign_count — debe ser mayor al guardado (anti-replay)
    if (signCount <= credential.signCount) {
      await audit.record('BIOMETRIC_LOGIN_REPLAY_ATTACK', {
        actorId: userId,
        details: { signCount },
        entityId: credentialId,
        entityType: 'BiometricCredential',
        entityTable: 'biometric_credentials',
        outcome: 'failure'
      });
      throw AppError.unauthorized('Sign count inválido — posible ataque de replay');
    }

    // Verificar la firma ES256
    const isValid = this._verifySignature({
      publicKey: credential.publicKey,
      challenge,
      signature
    });

    if (!isValid) {
      await audit.record('BIOMETRIC_LOGIN_INVALID_SIGNATURE', {
        actorId: userId,
        entityId: credentialId,
        entityType: 'BiometricCredential',
        entityTable: 'biometric_credentials',
        outcome: 'failure'
      });
      throw AppError.unauthorized('Firma biométrica inválida');
    }
  }

  // ============================================================
  // GESTIÓN DE CREDENCIALES
  // ============================================================

  /**
   * Lista las credenciales biométricas activas del usuario.
   */
  async getCredentials(userId: string) {
    const credentials = await this.biometricCredentialRepository.findAllByUser(userId);

    await audit.record('BIOMETRIC_CREDENTIALS_VIEWED', {
      actorId: userId,
      details: { count: credentials.length },
      entityType: 'BiometricCredential',
      entityTable: 'biometric_credentials'
    });

    return BiometricCredentialListDTO(credentials);
  }

  /**
   * Elimina (desactiva) una credencial biométrica.
   */
  async deleteCredential(userId: string, biometricCredentialId: string) {
    // Verificar que la credencial pertenece al usuario
    const credential = await this.biometricCredentialRepository.findByIdAndUser(biometricCredentialId, userId);
    if (!credential) {
      throw AppError.notFound('Credencial biométrica no encontrada');
    }

    await this.biometricCredentialRepository.deactivate(biometricCredentialId);

    await audit.record('BIOMETRIC_CREDENTIAL_DELETED', {
      actorId: userId,
      entityId: biometricCredentialId,
      entityType: 'BiometricCredential',
      entityTable: 'biometric_credentials'
    });

    return null;
  }

  // ============================================================
  // PRIVATE — Política de privacidad
  // ============================================================

  /**
   * Verifica si el usuario tiene la versión activa de la política de privacidad.
   * Si el request trae `acceptPolicy: true`, registra la versión activa y deja continuar el login
   * y deja continuar el login en un solo paso.
   * @private
   */
  _checkPrivacyPolicy(user: UserWith<'login'>, acceptPolicy: boolean, ip: string | null | undefined) {
    return this.policyGate.check(user, acceptPolicy, ip ?? null, {
      blockedAuditAction: 'BIOMETRIC_LOGIN_BLOCKED_POLICY_UPDATE',
      source: 'auth-biometric'
    });
  }

  // ============================================================
  // PRIVATE — Verificación ES256
  // ============================================================

  /**
   * Verifica una firma ES256 (ECDSA P-256 + SHA-256). La criptografía vive en
   * shared/utils/es256-signature.util.js; aquí solo se delega (inyectable para tests).
   * @returns {boolean}
   * @private
   */
  _verifySignature({ publicKey, challenge, signature }: { publicKey: string; challenge: string; signature: string }) {
    return this.verifySignature({ publicKey, challenge, signature });
  }
}


// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AuthBiometricService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    sessionControl?: InstanceType<typeof SessionControlService>;
    sessionIssuer?: InstanceType<typeof SessionIssuerService>;
    policyGate?: InstanceType<typeof LoginPolicyGateService>;
    userRepository?: typeof userRepository;
    userLoginAttemptRepository?: typeof userLoginAttemptRepository;
    trustedDeviceRepository?: typeof trustedDeviceRepository;
    privacyPolicyRepository?: typeof privacyPolicyRepository;
    consentRecorder?: typeof consentRecorder;
    biometricCredentialRepository?: typeof biometricCredentialRepository;
    biometricChallengeRepository?: typeof biometricChallengeRepository;
    userSessionRepository?: typeof userSessionRepository;
    verifySignature?: typeof verifyEs256Signature;
    notifier?: typeof notifier;
  }
}

export default Object.assign(new AuthBiometricService(), { AuthBiometricService });
