import ChangeLogService from '../services/admin-change-log.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../shared/presentation/validation/validate';
import { ChangeLogListQuery } from '../requests/audit.request';
const { requireAuthUser } = authUserUtilModule;

class ChangeLogController {
  listUserChangeLogs = asyncHandler(async (req, res) => {
    const result = await ChangeLogService.listUserChangeLogs(validQuery(req, ChangeLogListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Logs de cambios de usuarios obtenidos exitosamente', result);
  });
}

export default new ChangeLogController();
