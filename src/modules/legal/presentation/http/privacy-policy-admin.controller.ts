// Controlador HTTP del mantenedor admin de políticas de privacidad.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type { ListPrivacyPolicies } from '../../application/use-cases/list-privacy-policies.use-case';
import type { GetPrivacyPolicy } from '../../application/use-cases/get-privacy-policy.use-case';
import type { PublishPrivacyPolicy } from '../../application/use-cases/publish-privacy-policy.use-case';
import { PrivacyPolicyListQuery } from './requests/legal.request';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthUser } = authUserUtilModule;

export class PrivacyPolicyAdminController {
  constructor(
    private readonly listPrivacyPolicies: ListPrivacyPolicies,
    private readonly getPrivacyPolicy: GetPrivacyPolicy,
    private readonly publishPrivacyPolicy: PublishPrivacyPolicy
  ) {}

  /** GET /legal/privacy-policies */
  listVersions = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listPrivacyPolicies.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, PrivacyPolicyListQuery) });
    return ApiResponse.success(res, 'Versiones de política de privacidad obtenidas exitosamente', result);
  });

  /** GET /legal/privacy-policies/:privacyPolicyId */
  getVersionDetail = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.getPrivacyPolicy.execute({ actorId: requireAuthUser(req).userId, privacyPolicyId: routeParam(req, 'privacyPolicyId') });
    return ApiResponse.success(res, 'Detalle de política de privacidad obtenido exitosamente', result);
  });

  /** POST /legal/privacy-policies — multipart: el PDF en el campo policyDocument, el resto en el body */
  createVersion = asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
    const result = await this.publishPrivacyPolicy.execute({
      actorId: requireAuthUser(req).userId,
      version: req.body.version,
      document: files?.policyDocument?.[0]?.buffer ?? null,
      summary: req.body.summary,
      effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : undefined
    });
    return ApiResponse.created(res, 'Nueva versión de política de privacidad publicada exitosamente', result);
  });
}
