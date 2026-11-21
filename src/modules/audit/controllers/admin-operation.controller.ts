import AdminOperationService from '../services/admin-operation.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
import { validQuery } from '../../../shared/validation/validate';
import { OperationListQuery } from '../requests/audit.request';
const { requireAuthUser } = authUserUtilModule;

class AdminOperationController {
  list = asyncHandler(async (req, res) => {
    const result = await AdminOperationService.list(validQuery(req, OperationListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Operaciones obtenidas exitosamente', result);
  });

  timeline = asyncHandler(async (req, res) => {
    const result = await AdminOperationService.timeline(routeParam(req, 'operationId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Línea de tiempo de la operación obtenida exitosamente', result);
  });
}

export default new AdminOperationController();
