import NotificationPreferenceService from '../services/notification-preference.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;

class NotificationPreferenceController {
  /** GET /person/notifications/preferences */
  getPreference = asyncHandler(async (req, res) => {
    const result = await NotificationPreferenceService.getPreference(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Preferencias de notificación obtenidas exitosamente', result);
  });

  /** PUT /person/notifications/preferences */
  updatePreference = asyncHandler(async (req, res) => {
    const result = await NotificationPreferenceService.updatePreference(req.body, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Preferencias de notificación actualizadas exitosamente', result);
  });
}

export default new NotificationPreferenceController();
