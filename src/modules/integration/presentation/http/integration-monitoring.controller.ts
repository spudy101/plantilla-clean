// Controlador HTTP del monitoreo de proveedores: HTTP ↔ casos de uso, sin reglas de negocio.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type { GetProvidersHealth } from '../../application/use-cases/get-providers-health.use-case';
import type { ListFallbackHistory } from '../../application/use-cases/list-fallback-history.use-case';
import { FallbackQuery } from './requests/integration-monitoring.request';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtilModule;

export class IntegrationMonitoringController {
  constructor(
    private readonly getProvidersHealth: GetProvidersHealth,
    private readonly listFallbackHistory: ListFallbackHistory
  ) {}

  /** GET /providers/health */
  health = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.getProvidersHealth.execute({ actorId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Salud de proveedores obtenida exitosamente', data);
  });

  /** GET /fallbacks */
  fallbacks = asyncHandler(async (req: Request, res: Response) => {
    const { data, metadata } = await this.listFallbackHistory.execute({
      actorId: requireAuthUser(req).userId,
      query: validQuery(req, FallbackQuery)
    });
    return ApiResponse.success(res, 'Historial de fallbacks obtenido exitosamente', data, 200, metadata);
  });
}
