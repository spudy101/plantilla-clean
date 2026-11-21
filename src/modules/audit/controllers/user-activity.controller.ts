import UserActivityService from '../services/user-activity.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../shared/presentation/validation/validate';
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
