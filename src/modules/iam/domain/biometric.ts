// Credenciales biométricas (WebAuthn, ES256) y sus challenges de un solo uso (5 minutos).
//
// Registrar una huella solo se puede desde un dispositivo trusted; el login con huella firma el challenge con la
// llave privada del secure enclave y el sign_count del autenticador debe crecer siempre (anti-replay).
import { IamForbiddenError, IamInvalidInputError, InvalidBiometricChallengeError } from './errors';

/** COSE: -7 = ES256 (ECDSA P-256 + SHA-256). */
export const SUPPORTED_ALGORITHM = -7;

export type ChallengeType = 'registration' | 'authentication';

export interface BiometricCredential {
  userBiometricCredentialId: string;
  userId: string;
  userTrustedDeviceId: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BiometricChallenge {
  biometricChallengeId: string;
  userId: string | null;
  challenge: string;
  type: string;
  used: boolean;
  expiresAt: Date;
  createdAt: Date;
}

/** El challenge debe existir, ser del usuario y del tipo del paso (registro o login). */
export function assertChallengeFor(
  challenge: BiometricChallenge | null,
  userId: string,
  type: ChallengeType
): asserts challenge is BiometricChallenge {
  if (!challenge) {
    throw new InvalidBiometricChallengeError();
  }
  if (challenge.userId !== userId) {
    throw new IamForbiddenError('El challenge no pertenece a este usuario');
  }
  if (challenge.type !== type) {
    throw new IamInvalidInputError('Tipo de challenge incorrecto');
  }
}

/** El contador del autenticador debe ser mayor al guardado: si no, es una firma repetida. */
export function isReplayedSignCount(credential: Pick<BiometricCredential, 'signCount'>, signCount: number): boolean {
  return signCount <= credential.signCount;
}
