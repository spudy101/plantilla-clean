// Esquemas de salida (Zod) de la biometría.
import { z } from '../../../../../shared/presentation/validation/z';
import { BiometricCredentialSchema } from './auth-components.response';

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
