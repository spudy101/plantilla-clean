import IntegrationMonitoringService from '../services/integration-monitoring.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
import { validQuery } from '../../../shared/validation/validate';
import { FallbackQuery } from '../requests/integration-monitoring.request';
const { requireAuthUser } = authUserUtilModule;

class IntegrationMonitoringController {
  health = asyncHandler(async (req, res) => {
    const data = await IntegrationMonitoringService.getProvidersHealth(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Salud de proveedores obtenida exitosamente', data);
  });

  fallbacks = asyncHandler(async (req, res) => {
    const { data, metadata } = await IntegrationMonitoringService.getFallbackHistory(validQuery(req, FallbackQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Historial de fallbacks obtenido exitosamente', data, 200, metadata);
  });
}

export default new IntegrationMonitoringController();
