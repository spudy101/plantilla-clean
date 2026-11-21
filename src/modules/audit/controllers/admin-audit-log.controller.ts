import AdminAuditLogService from '../services/admin-audit-log.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
import { validQuery } from '../../../shared/validation/validate';
import { AuditLogListQuery } from '../requests/audit.request';
const { requireAuthUser } = authUserUtilModule;

class AdminAuditLogController {
  list = asyncHandler(async (req, res) => {
    const result = await AdminAuditLogService.list(validQuery(req, AuditLogListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Logs de auditoría obtenidos exitosamente', result);
  });

  getById = asyncHandler(async (req, res) => {
    const data = await AdminAuditLogService.getById(routeParam(req, 'auditLogId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Log de auditoría obtenido exitosamente', data);
  });

  exportLogs = asyncHandler(async (req, res) => {
    const format = typeof req.query.format === 'string' ? req.query.format : 'csv';
    await AdminAuditLogService.exportToResponse(res, req.query, requireAuthUser(req).userId, format);
  });
}

export default new AdminAuditLogController();
