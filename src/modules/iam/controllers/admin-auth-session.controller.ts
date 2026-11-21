import AdminAuthSessionService from '../services/admin-auth-session.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/presentation/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../shared/presentation/validation/validate';
import { AdminSessionListQuery, AttemptListQuery, AttemptsByUserQuery, SessionsByUserQuery } from '../requests/iam.request';
const { requireAuthUser } = authUserUtilModule;

class AdminAuthSessionController {
  listSessions = asyncHandler(async (req, res) => {
    const result = await AdminAuthSessionService.listSessions(validQuery(req, AdminSessionListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesiones obtenidas exitosamente', result);
  });

  getSessionsByUser = asyncHandler(async (req, res) => {
    const result = await AdminAuthSessionService.getSessionsByUser(routeParam(req, 'userId'), validQuery(req, SessionsByUserQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesiones del usuario obtenidas exitosamente', result);
  });

  revokeSession = asyncHandler(async (req, res) => {
    const result = await AdminAuthSessionService.revokeSession(routeParam(req, 'sessionId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesión revocada exitosamente', result);
  });

  listAttempts = asyncHandler(async (req, res) => {
    const result = await AdminAuthSessionService.listAttempts(validQuery(req, AttemptListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Intentos de autenticación obtenidos exitosamente', result);
  });

  getAttemptsByUser = asyncHandler(async (req, res) => {
    const result = await AdminAuthSessionService.getAttemptsByUser(routeParam(req, 'userId'), validQuery(req, AttemptsByUserQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Intentos del usuario obtenidos exitosamente', result);
  });
}

export default new AdminAuthSessionController();
