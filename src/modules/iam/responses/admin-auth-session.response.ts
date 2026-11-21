import type { PageMetadata } from '../../../shared/application/pagination';
import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import { UserRefSchema, UserSessionSchema } from './auth-components.response';
import type { SessionWithDeviceAndUser } from '../repositories/user-session.repository';
import type { AuditLogWithExecutor } from '../../audit';
import componentsAuthModule from './auth-components.response';
const { UserSessionComponent } = componentsAuthModule;

type SessionRow = SessionWithDeviceAndUser;
type AttemptRow = AuditLogWithExecutor;

function SessionDTO(session: SessionRow) {
  const device = session.device || null;
  return {
    ...UserSessionComponent.build(session),
    userId: session.userId,
    device: device
      ? {
          deviceId: device.userTrustedDeviceId,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
          browser: device.browser || null,
          os: device.os || null,
          status: device.status
        }
      : null
  };
}

function SessionListDTO(rows: SessionRow[], metadata: PageMetadata) {
  return {
    data: Array.isArray(rows) ? rows.map(s => SessionDTO(s)) : [],
    metadata
  };
}

function _buildExecutorRef(executor: AttemptRow['executor']) {
  if (!executor) {
    return null;
  }
  return {
    userId: executor.userId,
    username: executor.username,
    fullName: [executor.person?.firstName, executor.person?.lastName].filter(Boolean).join(' ') || null
  };
}

function AuthAttemptDTO(log: AttemptRow) {
  return {
    auditLogId: log.auditLogId,
    action: log.action,
    description: log.description || null,
    outcome: log.outcome,
    risk: log.risk,
    userId: log.userId || null,
    user: _buildExecutorRef(log.executor),
    ipAddress: log.ip || null,
    userAgent: log.userAgent || null,
    timestamp: log.createdAt,
    // Los rechazos 401/403 guardan el motivo en details (ver error.middleware)
    errorMessage: (log.details as { errorMessage?: string } | null)?.errorMessage ?? null
  };
}

function AuthAttemptListDTO(rows: AttemptRow[], metadata: PageMetadata) {
  return {
    data: Array.isArray(rows) ? rows.map(l => AuthAttemptDTO(l)) : [],
    metadata
  };
}

export default {
  SessionDTO,
  SessionListDTO,
  AuthAttemptDTO,
  AuthAttemptListDTO
};

// ── Esquemas de salida ──
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
