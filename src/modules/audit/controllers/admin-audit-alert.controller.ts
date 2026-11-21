import AdminAuditAlertService from '../services/admin-audit-alert.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/presentation/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../shared/presentation/validation/validate';
import { AuditAlertListQuery } from '../requests/audit.request';
const { requireAuthUser } = authUserUtilModule;

class AdminAuditAlertController {
  list = asyncHandler(async (req, res) => {
    const result = await AdminAuditAlertService.list(validQuery(req, AuditAlertListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Alertas de auditoría obtenidas exitosamente', result);
  });

  acknowledge = asyncHandler(async (req, res) => {
    const data = await AdminAuditAlertService.acknowledge(routeParam(req, 'alertId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Alerta reconocida exitosamente', data);
  });

  acknowledgeBulk = asyncHandler(async (req, res) => {
    const data = await AdminAuditAlertService.acknowledgeBulk(req.body.alertIds, requireAuthUser(req).userId);
    return ApiResponse.success(res, `${data.acknowledged} alertas reconocidas exitosamente`, data);
  });
}

export default new AdminAuditAlertController();
