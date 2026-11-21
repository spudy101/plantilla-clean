// Controlador HTTP de la revisión admin de consentimientos otorgados.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type { ListUserConsents } from '../../application/use-cases/list-user-consents.use-case';
import type { GetUserConsentHistory } from '../../application/use-cases/get-user-consent-history.use-case';
import { AdminUserConsentListQuery, ConsentHistoryQuery } from './requests/legal.request';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthUser } = authUserUtilModule;

export class AdminUserConsentController {
  constructor(
    private readonly listUserConsents: ListUserConsents,
    private readonly getUserConsentHistory: GetUserConsentHistory
  ) {}

  /** GET /legal/user-consents */
  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listUserConsents.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, AdminUserConsentListQuery) });
    return ApiResponse.success(res, 'Consentimientos obtenidos exitosamente', result);
  });

  /** GET /legal/user-consents/users/:userId */
  getHistoryByUser = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.getUserConsentHistory.execute({
      actorId: requireAuthUser(req).userId,
      userId: routeParam(req, 'userId'),
      query: validQuery(req, ConsentHistoryQuery)
    });
    return ApiResponse.success(res, 'Historial de consentimientos obtenido exitosamente', result);
  });
}
