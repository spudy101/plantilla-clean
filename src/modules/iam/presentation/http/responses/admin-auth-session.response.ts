// Esquemas de salida (Zod) de la vista admin de sesiones e intentos de autenticación.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';
import { UserRefSchema, UserSessionSchema } from './auth-components.response';

export const AdminSessionSchema = UserSessionSchema.extend({
  userId: z.uuid(),
  device: z
    .object({
      deviceId: z.uuid(),
      deviceName: z.string().nullable(),
      deviceType: z.string().nullable().meta({ example: 'desktop' }),
      browser: z.string().nullable(),
      os: z.string().nullable(),
      status: z.string().nullable()
    })
    .nullable()
});

export const AuthAttemptSchema = z
  .object({
    auditLogId: z.uuid(),
    action: z.string().meta({ example: 'LOGIN_FAILED' }),
    description: z.string().nullable(),
    outcome: z.string().meta({ example: 'failure' }),
    risk: z.string(),
    userId: z.uuid().nullable(),
    user: UserRefSchema.nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    timestamp: dateTime(),
    errorMessage: z.string().nullable()
  })
  .meta({ description: 'Intento de autenticación (registro de auditoría de la categoría Autenticación).' });

// Resultado armado en el service (sin función DTO)
export const SessionRevokedSchema = z.object({
  sessionId: z.uuid(),
  status: z.literal('closed'),
  closeReason: z.literal('revoked_by_admin')
});
export type SessionRevoked = z.infer<typeof SessionRevokedSchema>;
