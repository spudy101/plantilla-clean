import UserActivityService from '../services/user-activity.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
import { validQuery } from '../../../shared/validation/validate';
import { RecentActivityQuery } from '../requests/audit.request';
const { requireAuthUser } = authUserUtilModule;

class UserActivityController {
  /** GET /audit/recent-activity — feed de actividad del propio usuario autenticado */
  list = asyncHandler(async (req, res) => {
    const result = await UserActivityService.getRecentActivity(requireAuthUser(req).userId, validQuery(req, RecentActivityQuery));
    return ApiResponse.success(res, 'Actividad reciente obtenida exitosamente', result);
  });
}

export default new UserActivityController();
