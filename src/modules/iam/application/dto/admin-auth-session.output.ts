// Salidas de la vista admin de sesiones e intentos de autenticación.
import type { PageMetadata } from '../../../../shared/application/pagination';
import type { SessionWithDeviceAndUser } from '../../domain/session';
import type { AuthAttempt } from '../ports/module-sources.port';
import componentsAuthModule from './auth-components.output';
const { UserSessionComponent } = componentsAuthModule;

type SessionRow = SessionWithDeviceAndUser;
type AttemptRow = AuthAttempt;

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


/** Resultado de revocar una sesión desde el panel. */
export interface SessionRevoked {
  sessionId: string;
  status: 'closed';
  closeReason: 'revoked_by_admin';
}
