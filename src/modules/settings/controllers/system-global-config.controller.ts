import SystemGlobalConfigService from '../services/system-global-config.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;
import auditModule from '../../audit';
const { adminAuditContextUtil: adminAuditContextUtilModule } = auditModule;
const { adminAuditContext } = adminAuditContextUtilModule;

class SystemGlobalConfigController {
  getConfig = asyncHandler(async (req, res) => {
    const data = await SystemGlobalConfigService.getConfig(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Configuración global obtenida exitosamente', data);
  });

  updateConfig = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const auditCtx = adminAuditContext(req, res);
    const data = await SystemGlobalConfigService.updateConfig(req.body, user.userId, auditCtx);
    return ApiResponse.success(res, 'Configuración global actualizada exitosamente', data);
  });
}

export default new SystemGlobalConfigController();
