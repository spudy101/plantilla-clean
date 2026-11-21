// Controlador HTTP de los consentimientos del propio usuario (portal cliente).
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import type { ListMyConsents } from '../../application/use-cases/list-my-consents.use-case';
import type { GrantConsents } from '../../application/use-cases/grant-consents.use-case';
import type { RevokeConsent } from '../../application/use-cases/revoke-consent.use-case';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthUser } = authUserUtilModule;

/** IP y user agent de la petición (los deja el middleware de auditoría en res.locals). */
function clientContext(res: Response) {
  return { ip: res.locals.auditContext?.ip ?? null, userAgent: res.locals.auditContext?.userAgent ?? null };
}

export class UserConsentController {
  constructor(
    private readonly listMyConsents: ListMyConsents,
    private readonly grantConsents: GrantConsents,
    private readonly revokeConsent: RevokeConsent
  ) {}

  /** GET /legal/consents */
  getMyConsents = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.listMyConsents.execute({ userId: requireAuthUser(req).userId });
    return ApiResponse.success(res, 'Consentimientos obtenidos exitosamente', data);
  });

  /** POST /legal/consents/grant — el body es el array de consentimientos */
  grant = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.grantConsents.execute({ userId: requireAuthUser(req).userId, items: req.body, ...clientContext(res) });
    return ApiResponse.success(res, 'Consentimientos registrados exitosamente', data, 201);
  });

  /** POST /legal/consents/:consentTypeId/revoke */
  revokeMarketing = asyncHandler(async (req: Request, res: Response) => {
    const { message } = await this.revokeConsent.execute({
      userId: requireAuthUser(req).userId,
      consentTypeId: routeParam(req, 'consentTypeId'),
      ip: clientContext(res).ip,
      reason: req.body.reason
    });
    return ApiResponse.success(res, message, null);
  });
}
