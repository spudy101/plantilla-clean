// shared/types/audit-context.ts
//
// Contexto de auditoría de una acción administrativa: quién la hace y desde dónde. Lo arman los
// controllers admin a partir de req.user + res.locals.auditContext y viaja hasta los services
// (logAudit, user_change_logs, doble aprobación).

export interface AdminAuditContext {
  adminUserId: string;
  adminRoleName?: string | null;
  adminFirstName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Contexto HTTP de una petición (audit.middleware → res.locals.auditContext), más lo que algunos
 * controllers le agregan antes de pasarlo a los services (clientType, acceptPolicy, serverContext).
 */
export interface RequestAuditContext {
  correlationId?: string;
  ip?: string | null;
  /** Algunos call-sites lo nombran ipAddress */
  ipAddress?: string | null;
  userAgent?: string | null;
  fingerprintHash?: string | null;
  method?: string;
  path?: string;
  source?: string;
  clientType?: string | null;
  acceptPolicy?: boolean;
  serverContext?: string | null;
  /** Registro de push en el login mobile (vienen en el body de /auth/login) */
  pushToken?: string | null;
  pushDeviceId?: string | null;
  pushPlatform?: string | null;
}
