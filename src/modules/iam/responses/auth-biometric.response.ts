import { z } from '../../../shared/presentation/validation/z';
import { BiometricCredentialSchema } from './auth-components.response';

import componentsAuthModule from './auth-components.response';
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

// ── Esquemas de salida ──
export const BiometricRegisterStartSchema = z.object({
  challenge: z.string().meta({ description: 'Desafío WebAuthn (base64url) que el dispositivo debe firmar.' }),
  deviceId: z.uuid(),
  algorithm: z.number().int().meta({ example: -7, description: 'Algoritmo COSE (-7 = ES256).' })
});

export const BiometricRegisterFinishSchema = BiometricCredentialSchema.pick({
  biometricCredentialId: true,
  credentialId: true,
  deviceId: true,
  createdAt: true
});

export const BiometricLoginStartSchema = z.object({
  challenge: z.string(),
  userId: z.uuid().nullable().meta({ description: 'null si el documento no corresponde a un usuario (no se revela).' })
});

export const BiometricCredentialListSchema = z.object({
  credentials: z.array(BiometricCredentialSchema),
  total: z.number().int()
});
