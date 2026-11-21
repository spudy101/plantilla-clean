import AdminSessionTraceService from '../services/admin-session-trace.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
import { validQuery } from '../../../shared/validation/validate';
import { SessionListQuery, SessionTimelineQuery } from '../requests/audit.request';
const { requireAuthUser } = authUserUtilModule;

class AdminSessionTraceController {
  list = asyncHandler(async (req, res) => {
    const result = await AdminSessionTraceService.listSessions(validQuery(req, SessionListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesiones obtenidas exitosamente', result);
  });

  timeline = asyncHandler(async (req, res) => {
    const result = await AdminSessionTraceService.getSessionTimeline(routeParam(req, 'sessionId'), validQuery(req, SessionTimelineQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Traza de sesión obtenida exitosamente', result);
  });

  entities = asyncHandler(async (req, res) => {
    const result = await AdminSessionTraceService.getSessionEntities(routeParam(req, 'sessionId'), req.query, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Entidades de la sesión obtenidas exitosamente', result);
  });
}

export default new AdminSessionTraceController();
