// Salidas de la biometría: challenges y credenciales.
import componentsAuthModule from './auth-components.output';
const { BiometricCredentialComponent } = componentsAuthModule;

/**
 * ============================================================
 * AUTH BIOMETRIC DTOs — CLIENT
 * ============================================================
 */

function BiometricRegisterStartDTO({
  challenge,
  deviceId,
  algorithm
}: {
  challenge: string;
  deviceId: string;
  /** COSE: -7 = ES256 */ algorithm: number;
}) {
  return { challenge, deviceId, algorithm };
}

function BiometricRegisterFinishDTO(credential: Parameters<typeof BiometricCredentialComponent.build>[0]) {
  const built = BiometricCredentialComponent.build(credential);
  if (!built) {
    return null;
  }
  return {
    biometricCredentialId: built.biometricCredentialId,
    credentialId: built.credentialId,
    deviceId: built.deviceId,
    createdAt: built.createdAt
  };
}

function BiometricLoginStartDTO({ challenge, userId }: { challenge: string; userId: string | null }) {
  return { challenge, userId };
}

const BiometricCredentialDTO = (credential: Parameters<typeof BiometricCredentialComponent.build>[0]) =>
  BiometricCredentialComponent.build(credential);

function BiometricCredentialListDTO(credentials: Parameters<typeof BiometricCredentialComponent.buildArray>[0]) {
  const list = BiometricCredentialComponent.buildArray(credentials);
  return { credentials: list, total: list.length };
}

export default {
  BiometricRegisterStartDTO,
  BiometricRegisterFinishDTO,
  BiometricLoginStartDTO,
  BiometricCredentialDTO,
  BiometricCredentialListDTO
};

