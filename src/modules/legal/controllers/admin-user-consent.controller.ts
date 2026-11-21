import AdminUserConsentService from '../services/admin-user-consent.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/presentation/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../shared/presentation/validation/validate';
import { AdminUserConsentListQuery, ConsentHistoryQuery } from '../requests/legal.request';
const { requireAuthUser } = authUserUtilModule;

class AdminUserConsentController {
  list = asyncHandler(async (req, res) => {
    const result = await AdminUserConsentService.list(validQuery(req, AdminUserConsentListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Consentimientos obtenidos exitosamente', result);
  });

  getHistoryByUser = asyncHandler(async (req, res) => {
    const result = await AdminUserConsentService.getHistoryByUser(routeParam(req, 'userId'), validQuery(req, ConsentHistoryQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Historial de consentimientos obtenido exitosamente', result);
  });
}

export default new AdminUserConsentController();
