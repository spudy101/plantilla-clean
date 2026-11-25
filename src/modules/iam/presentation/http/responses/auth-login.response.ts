// Esquemas de salida (Zod) del login, el reto MFA, la política pendiente y los dispositivos.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import { TrustedDeviceSchema } from './auth-components.response';
import { PersonContactSchema, PersonLocationSchema, PersonSchema, UserSchema } from '../../../../../shared/presentation/validation/account.schemas';

export const AuthTokensSchema = z.object({
  accessToken: z.string().meta({ description: 'JWT de acceso (Bearer).' }),
  refreshToken: z.string(),
  expiresIn: z.number().int().meta({ example: 3600, description: 'Segundos de vigencia del access token.' })
});

export const LoginSchema = z.object({
  user: UserSchema.nullable(),
  deviceId: z.uuid().nullable().meta({ description: 'Dispositivo de confianza con el que se inició sesión.' }),
  person: PersonSchema.nullable().optional(),
  contact: PersonContactSchema.nullable().optional(),
  location: PersonLocationSchema.nullable().optional(),
  tokens: AuthTokensSchema.optional(),
  hmacSecret: z.string().optional().meta({ description: 'Secreto HMAC del dispositivo. Solo la primera vez que se registra.' })
});

export const PolicyUpdateRequiredSchema = z.object({
  requiresPolicyAcceptance: z.literal(true),
  policy: z.object({
    currentVersion: z.string().nullable(),
    newVersion: z.string().meta({ example: '2.0' }),
    documentUrl: z.string(),
    summary: z.string().nullable(),
    effectiveDate: dateTime().nullable()
  }),
  message: z.string()
});

export const DeviceApprovalRequiredSchema = z.object({
  requiresDeviceApproval: z.literal(true),
  deviceId: z.uuid(),
  message: z.string()
});

export const MfaRequiredSchema = z.object({
  requiresMFA: z.literal(true),
  challengeType: z.string().meta({ example: 'SOFTWARE_TOKEN_MFA' }),
  preferredMfaMethod: z.string().meta({ example: 'totp', description: 'none | totp | sms' }),
  username: z.string().nullable(),
  session: z.string().meta({ description: 'Sesión del desafío: se envía en verify-mfa.' })
});

export const TrustedDeviceListSchema = z.object({ devices: z.array(TrustedDeviceSchema), total: z.number().int() });

export const TrustedDeviceUpdateSchema = z.object({
  userTrustedDeviceId: z.uuid(),
  deviceName: z.string().nullable(),
  status: z.string().meta({ example: 'trusted' }),
  updatedAt: dateTime()
});

// Resultados armados en el service (sin función DTO)
export const SessionClosedSchema = z.object({ sessionId: z.uuid(), status: z.literal('closed') });
export type SessionClosed = z.infer<typeof SessionClosedSchema>;
export const OtherSessionsClosedSchema = z.object({
  closedCount: z.number().int().meta({ example: 2, description: 'Sesiones cerradas (todas menos la actual).' })
});
export type OtherSessionsClosed = z.infer<typeof OtherSessionsClosedSchema>;
