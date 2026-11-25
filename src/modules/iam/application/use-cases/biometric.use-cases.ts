// Casos de uso de la huella (WebAuthn, ES256) del portal cliente: registrarla desde un dispositivo trusted (start +
// finish), iniciar sesión con ella (start + finish), listarlas y eliminar una.
//
// La firma ES256 verificada YA autentica al usuario: la huella desbloqueó la llave privada en el secure enclave del
// dispositivo. El login emite los tokens propios igual que el login por contraseña, con la misma política de sesiones.
import {
  IamConflictError,
  IamForbiddenError,
  IamNotFoundError,
  IamUnauthorizedError,
  InactiveAccountError,
  InvalidBiometricChallengeError
} from '../../domain/errors';
import { assertChallengeFor, isReplayedSignCount, SUPPORTED_ALGORITHM, type BiometricCredential } from '../../domain/biometric';
import { loginHandle } from '../../domain/user';
import authBiometricDtoModule from '../dto/auth-biometric.output';
import authLoginDtoModule from '../dto/auth-login.output';
import type { IamDeps } from './iam-deps';
import type { LoginContext, LoginPolicyGate } from './login-steps';
import type { SessionControl, SessionIssuer } from './sessions';

const { BiometricRegisterStartDTO, BiometricRegisterFinishDTO, BiometricLoginStartDTO, BiometricCredentialListDTO } = authBiometricDtoModule;
const { LoginResponseDTO } = authLoginDtoModule;

const CHALLENGE_BYTES = 32;

type BiometricDeps = Pick<IamDeps, 'devices' | 'biometricCredentials' | 'biometricChallenges' | 'signatures' | 'random' | 'audit'>;

const credentialEntity = (id: string) => ({ entityId: id, entityType: 'BiometricCredential', entityTable: 'biometric_credentials' });

/** Solo desde un dispositivo TRUSTED se registra una huella. */
async function trustedDeviceOf(deps: Pick<IamDeps, 'devices'>, userId: string, fingerprintHash: string) {
  const device = await deps.devices.findByFingerprint(userId, fingerprintHash);
  if (!device || device.status !== 'trusted') {
    throw new IamForbiddenError('Solo puedes registrar una huella desde un dispositivo de confianza');
  }
  return device;
}

// ============================================================
// REGISTRO
// ============================================================

export class StartBiometricRegistration {
  constructor(private readonly deps: BiometricDeps) {}

  async execute(userId: string, fingerprintHash: string) {
    const { biometricCredentials, biometricChallenges, random, audit } = this.deps;
    const device = await trustedDeviceOf(this.deps, userId, fingerprintHash);

    if (await biometricCredentials.findByUserAndDevice(userId, device.userTrustedDeviceId)) {
      throw new IamConflictError('Este dispositivo ya tiene una huella registrada. Elimínala primero.');
    }

    const challenge = random.base64url(CHALLENGE_BYTES);
    await biometricChallenges.create({ userId, challenge, type: 'registration' });

    await audit.record('BIOMETRIC_REGISTER_START', {
      actorId: userId,
      entityId: device.userTrustedDeviceId,
      entityType: 'UserTrustedDevice',
      entityTable: 'user_trusted_devices'
    });
    return BiometricRegisterStartDTO({ challenge, deviceId: device.userTrustedDeviceId, algorithm: SUPPORTED_ALGORITHM });
  }
}

export interface BiometricRegistration {
  /** base64url: lo genera el dispositivo. */
  credentialId: string;
  /** Llave pública ES256 (base64url o PEM). */
  publicKey: string;
  /** El challenge de StartBiometricRegistration. */
  challenge: string;
  /** El challenge firmado con la llave privada. */
  signature: string;
}

export class FinishBiometricRegistration {
  constructor(private readonly deps: BiometricDeps & Pick<IamDeps, 'users' | 'notifier' | 'logger' | 'policy'>) {}

  async execute({ credentialId, publicKey, challenge, signature }: BiometricRegistration, userId: string, fingerprintHash: string) {
    const { biometricCredentials, biometricChallenges, signatures, users, audit, notifier, logger, policy } = this.deps;
    const device = await trustedDeviceOf(this.deps, userId, fingerprintHash);

    const challengeRecord = await biometricChallenges.findValid(challenge);
    assertChallengeFor(challengeRecord, userId, 'registration');
    // Se consume ANTES de verificar y solo si sigue sin usar: si otro request lo usó primero, es un replay
    if (!(await biometricChallenges.markAsUsed(challengeRecord.biometricChallengeId))) {
      throw new InvalidBiometricChallengeError();
    }

    if (!signatures.verify({ publicKey, challenge, signature })) {
      await audit.record('BIOMETRIC_REGISTER_INVALID_SIGNATURE', {
        actorId: userId,
        entityId: device.userTrustedDeviceId,
        entityType: 'UserTrustedDevice',
        entityTable: 'user_trusted_devices',
        outcome: 'failure'
      });
      throw new IamUnauthorizedError('Firma biométrica inválida');
    }

    if (await biometricCredentials.findByCredentialId(credentialId)) {
      throw new IamConflictError('Esta credencial biométrica ya está registrada');
    }

    const credential = await biometricCredentials.create({
      userId,
      userTrustedDeviceId: device.userTrustedDeviceId,
      credentialId,
      publicKey,
      signCount: 0
    });

    await audit.record('BIOMETRIC_REGISTER_SUCCESS', {
      actorId: userId,
      details: { deviceId: device.userTrustedDeviceId },
      ...credentialEntity(credential.userBiometricCredentialId)
    });

    setImmediate(() => {
      users
        .findProfile(userId)
        .then(user =>
          notifier.notify({
            type: 'BIOMETRIC_CREDENTIAL_REGISTERED',
            userId,
            relatedEntity: { type: 'BiometricCredential', id: credential.userBiometricCredentialId },
            metadata: { nombre: user?.person?.firstName ?? 'Usuario', logoUrl: policy.notificationLogoUrl }
          })
        )
        .catch(err => logger.warn('Error enviando notificación biométrico registrado', { error: err.message }));
    });

    return BiometricRegisterFinishDTO(credential);
  }
}

// ============================================================
// LOGIN
// ============================================================

/** Endpoint público: el documento identifica al usuario. */
export class StartBiometricLogin {
  constructor(private readonly deps: BiometricDeps & Pick<IamDeps, 'users'>) {}

  async execute({ nationalId }: { nationalId: string }) {
    const { users, biometricChallenges, random, audit } = this.deps;
    const user = await users.findLoginUserByNationalId(nationalId);
    if (!user) {
      throw new IamUnauthorizedError('Credenciales inválidas');
    }
    if (!user.isActive) {
      throw new InactiveAccountError();
    }

    const challenge = random.base64url(CHALLENGE_BYTES);
    await biometricChallenges.create({ userId: user.userId, challenge, type: 'authentication' });

    await audit.record('BIOMETRIC_LOGIN_START', {
      actorId: user.userId,
      details: { nationalId },
      entityId: user.userId,
      entityType: 'User',
      entityTable: 'users'
    });
    return BiometricLoginStartDTO({ challenge, userId: user.userId });
  }
}

export interface BiometricAssertion {
  credentialId: string;
  challenge: string;
  signature: string;
  /** Contador del autenticador: debe ser mayor al guardado. */
  signCount: number;
}

type BiometricLoginDeps = BiometricDeps &
  Pick<IamDeps, 'users' | 'loginAttempts'> & { policyGate: LoginPolicyGate; sessionControl: SessionControl; sessionIssuer: SessionIssuer };

export class FinishBiometricLogin {
  constructor(private readonly deps: BiometricLoginDeps) {}

  async execute({ credentialId, challenge, signature, signCount }: BiometricAssertion, context: LoginContext) {
    const { biometricCredentials, devices, users, loginAttempts, policyGate, sessionControl, sessionIssuer, audit } = this.deps;
    const { ip, userAgent, fingerprintHash } = context;

    const credential = await biometricCredentials.findByCredentialId(credentialId);
    if (!credential) {
      throw new IamUnauthorizedError('Credencial biométrica no encontrada');
    }
    const { userId } = credential;
    await this.verifyChallenge(credential, challenge, signature, signCount);

    const user = await users.findLoginUser(userId);
    if (!user) {
      throw new IamUnauthorizedError('Usuario no encontrado');
    }
    if (!user.isActive) {
      throw new InactiveAccountError();
    }

    // La política de privacidad: la misma compuerta que el login por contraseña
    const policyCheck = await policyGate.check(user, context.acceptPolicy === true, context.ip ?? null, {
      blockedAuditAction: 'BIOMETRIC_LOGIN_BLOCKED_POLICY_UPDATE',
      source: 'auth-biometric'
    });
    if (policyCheck) {
      return policyCheck;
    }

    // El dispositivo de la credencial debe seguir siendo de confianza
    const device = await devices.findById(credential.userTrustedDeviceId);
    if (!device || device.status !== 'trusted') {
      throw new IamForbiddenError('El dispositivo asociado a esta credencial ya no es de confianza');
    }

    // Una sesión por dispositivo + límite de sesiones simultáneas
    await sessionControl.closePreviousDeviceSessions(userId, device.userTrustedDeviceId);
    await sessionControl.enforceSessionLimit(userId);

    const { sessionId, tokens } = await sessionIssuer.issue(user, {
      deviceId: device.userTrustedDeviceId,
      ip,
      userAgent,
      source: 'login biométrico'
    });

    await Promise.all([
      biometricCredentials.updateAfterLogin(credentialId, signCount),
      devices.updateLastSeen(userId, device.fingerprintHash),
      loginAttempts.record({
        userId,
        usernameAttempt: loginHandle(user),
        nationalId: user.username,
        ipAddress: ip,
        userAgent,
        deviceFingerprint: fingerprintHash,
        success: true,
        // Explícito: la ruta es pública y el contexto no trae la sesión recién creada
        originSessionId: sessionId
      })
    ]);

    await audit.record('BIOMETRIC_LOGIN_SUCCESS', {
      actorId: userId,
      details: { deviceId: device.userTrustedDeviceId },
      ...credentialEntity(credentialId)
    });

    return LoginResponseDTO({
      user,
      tokens,
      deviceId: device.userTrustedDeviceId,
      // El mobile necesita el secreto HMAC para firmar los requests siguientes
      deviceHmacSecret: device.hmacSecret || null
    });
  }

  /** Consume el challenge y verifica el sign_count y la firma. */
  private async verifyChallenge(credential: BiometricCredential, challenge: string, signature: string, signCount: number) {
    const { biometricChallenges, signatures, audit } = this.deps;
    const { userId, credentialId } = credential;

    const challengeRecord = await biometricChallenges.findValid(challenge);
    assertChallengeFor(challengeRecord, userId, 'authentication');
    if (!(await biometricChallenges.markAsUsed(challengeRecord.biometricChallengeId))) {
      throw new InvalidBiometricChallengeError();
    }

    if (isReplayedSignCount(credential, signCount)) {
      await audit.record('BIOMETRIC_LOGIN_REPLAY_ATTACK', {
        actorId: userId,
        details: { signCount },
        ...credentialEntity(credentialId),
        outcome: 'failure'
      });
      throw new IamUnauthorizedError('Sign count inválido — posible ataque de replay');
    }

    if (!signatures.verify({ publicKey: credential.publicKey, challenge, signature })) {
      await audit.record('BIOMETRIC_LOGIN_INVALID_SIGNATURE', { actorId: userId, ...credentialEntity(credentialId), outcome: 'failure' });
      throw new IamUnauthorizedError('Firma biométrica inválida');
    }
  }
}

// ============================================================
// GESTIÓN
// ============================================================

export class ListBiometricCredentials {
  constructor(private readonly deps: BiometricDeps) {}

  async execute(userId: string) {
    const credentials = await this.deps.biometricCredentials.findAllByUser(userId);
    await this.deps.audit.record('BIOMETRIC_CREDENTIALS_VIEWED', {
      actorId: userId,
      details: { count: credentials.length },
      entityType: 'BiometricCredential',
      entityTable: 'biometric_credentials'
    });
    return BiometricCredentialListDTO(credentials);
  }
}

export class DeleteBiometricCredential {
  constructor(private readonly deps: BiometricDeps) {}

  async execute(userId: string, biometricCredentialId: string): Promise<null> {
    const { biometricCredentials, audit } = this.deps;
    if (!(await biometricCredentials.findByIdAndUser(biometricCredentialId, userId))) {
      throw new IamNotFoundError('Credencial biométrica no encontrada');
    }
    await biometricCredentials.deactivate(biometricCredentialId);
    await audit.record('BIOMETRIC_CREDENTIAL_DELETED', { actorId: userId, ...credentialEntity(biometricCredentialId) });
    return null;
  }
}
