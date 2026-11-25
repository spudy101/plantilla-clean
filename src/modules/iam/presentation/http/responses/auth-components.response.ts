// Esquemas de salida (Zod) de las piezas de iam: referencia a usuario, sesión, bitácora de cambios, código OTP,
// dispositivo de confianza y credencial biométrica. Documentan lo que arma application/dto/auth-components.output.ts.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

export const UserRefSchema = z.object({
  userId: z.uuid(),
  username: z.string().nullish().meta({ example: 'jdoe' }),
  fullName: z.string().nullable().meta({ example: 'John Doe' })
});

export const UserSessionSchema = z.object({
  sessionId: z.uuid(),
  status: z.string().meta({ example: 'active', description: 'active | closed' }),
  ipAddress: z.string().nullable().meta({ example: '190.114.45.227' }),
  userAgent: z.string().nullable(),
  startedAt: dateTime(),
  lastAccessAt: dateTime(),
  closedAt: dateTime().nullable(),
  closeReason: z.string().nullable().meta({ example: 'revoked_by_admin' }),
  createdAt: dateTime(),
  user: UserRefSchema.nullable()
});

export const UserChangeLogSchema = z
  .object({
    logId: z.uuid(),
    userId: z.uuid().nullable().meta({ description: 'Usuario afectado por el cambio.' }),
    user: UserRefSchema.nullable(),
    changedByUserId: z.uuid().nullable().meta({ description: 'Usuario que hizo el cambio.' }),
    changedByRole: z.string().meta({ example: 'admin', description: 'user | admin | system' }),
    changedBy: UserRefSchema.nullable().meta({ description: 'null si lo hizo el sistema.' }),
    changeType: z.string().meta({ example: 'email', description: 'Campo o entidad que cambió.' }),
    previousValue: z
      .string()
      .nullable()
      .meta({ description: 'Valor anterior. Correos, documentos y teléfonos salen enmascarados; contraseñas como `hidden`.' }),
    newValue: z.string().nullable().meta({ description: 'Valor nuevo. Mismo enmascaramiento que `previousValue`.' }),
    changeReason: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    originSessionId: z.uuid().nullable().meta({ description: 'Sesión desde la que se hizo. null si fue un worker.' }),
    createdAt: dateTime()
  })
  .meta({ description: 'Cambio sobre los datos de una cuenta (vista sobre audit_logs).' });

export const VerificationCodeSchema = z.object({
  verificationCodeId: z.uuid(),
  type: z.string().meta({ example: 'email' }),
  contactValue: z.string().nullable().meta({ description: 'Correo o teléfono, enmascarado.' }),
  attempts: z.number().int().nullable(),
  expiresAt: dateTime(),
  verifiedAt: dateTime().nullable(),
  isVerified: z.boolean(),
  isExpired: z.boolean(),
  createdAt: dateTime().nullable()
});

export const TrustedDeviceSchema = z
  .object({
    userTrustedDeviceId: z.uuid(),
    userId: z.uuid(),
    deviceName: z.string().nullable().meta({ example: 'iPhone de Ana' }),
    fingerprintHash: z.string().nullable(),
    isCurrent: z.boolean().meta({ description: 'true si es el dispositivo desde el que se hace la consulta.' }),
    status: z.string().meta({ example: 'trusted', description: 'pending | trusted | blocked' }),
    isPending: z.boolean(),
    ipAddress: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    countryCode: z.string().nullable().meta({ example: 'CO' }),
    browser: z.string().nullable().meta({ example: 'Chrome' }),
    os: z.string().nullable().meta({ example: 'iOS' }),
    deviceType: z.string().meta({ example: 'mobile' }),
    approvedByDeviceId: z.uuid().nullable(),
    approvedAt: dateTime().nullable(),
    blockedByDeviceId: z.uuid().nullable(),
    blockedAt: dateTime().nullable(),
    activeSession: UserSessionSchema.nullable().meta({ description: 'Última sesión del dispositivo.' }),
    trustedAt: dateTime().nullable(),
    lastSeenAt: dateTime().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime()
  })
  .meta({ description: 'Dispositivo de confianza del usuario.' });

export const BiometricCredentialSchema = z.object({
  biometricCredentialId: z.uuid(),
  deviceId: z.uuid().meta({ description: 'Dispositivo de confianza al que está atada la credencial.' }),
  credentialId: z.string().meta({ description: 'ID de la credencial WebAuthn (base64url).' }),
  signCount: z.number().int(),
  isActive: z.boolean(),
  lastUsedAt: dateTime().nullable(),
  createdAt: dateTime()
});
