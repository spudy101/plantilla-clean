// shared/utils/admin-audit-context.util.ts
//
// Contexto de auditoría de una acción admin a partir del request autenticado + el contexto HTTP que
// arma audit.middleware. Antes cada controller admin tenía su copia (_auditCtx / _approverCtx), con
// variaciones sueltas (unas sin rol, otras sin nombre).
import type { Request, Response } from 'express';
import type { AdminAuditContext, RequestAuditContext } from '../../../shared/types/audit-context';
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;

function adminAuditContext(req: Request, res: Response): AdminAuditContext {
  const user = requireAuthUser(req);
  const http = (res.locals.auditContext ?? {}) as RequestAuditContext;
  return {
    adminUserId: user.userId,
    adminRoleName: user.roleName,
    adminFirstName: user.firstName,
    ipAddress: http.ip ?? null,
    userAgent: http.userAgent ?? null
  };
}

export default { adminAuditContext };
