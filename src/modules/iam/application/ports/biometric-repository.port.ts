// Puerto: las credenciales biométricas y sus challenges de un solo uso.
import type { BiometricChallenge, BiometricCredential, ChallengeType } from '../../domain/biometric';

export interface BiometricCredentialRepository {
  /** Activa, por el id que envía el dispositivo. */
  findByCredentialId(credentialId: string): Promise<BiometricCredential | null>;
  findByIdAndUser(biometricCredentialId: string, userId: string): Promise<BiometricCredential | null>;
  /** La activa del usuario en ese dispositivo. */
  findByUserAndDevice(userId: string, deviceId: string): Promise<BiometricCredential | null>;
  findAllByUser(userId: string): Promise<BiometricCredential[]>;
  create(credential: {
    userId: string;
    userTrustedDeviceId: string;
    credentialId: string;
    publicKey: string;
    signCount: number;
  }): Promise<BiometricCredential>;
  updateAfterLogin(credentialId: string, signCount: number): Promise<number>;
  /** Borrado lógico. */
  deactivate(biometricCredentialId: string): Promise<BiometricCredential>;
}

export interface BiometricChallengeRepository {
  /** Vence a los 5 minutos. */
  create(challenge: { userId: string | null; challenge: string; type: ChallengeType }): Promise<BiometricChallenge>;
  /** Mismo valor, sin usar y vigente. */
  findValid(challenge: string): Promise<BiometricChallenge | null>;
  /** Lo marca usado si seguía sin usar: false = otro request lo consumió primero (replay). */
  markAsUsed(biometricChallengeId: string): Promise<boolean>;
}
