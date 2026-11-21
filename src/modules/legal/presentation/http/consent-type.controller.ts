// Controlador HTTP del mantenedor admin de tipos de consentimiento: HTTP ↔ casos de uso, sin reglas.
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type { ListConsentTypes } from '../../application/use-cases/list-consent-types.use-case';
import type { GetConsentType } from '../../application/use-cases/get-consent-type.use-case';
import type { CreateConsentType } from '../../application/use-cases/create-consent-type.use-case';
import type { UpdateConsentType } from '../../application/use-cases/update-consent-type.use-case';
import { ConsentTypeListQuery } from './requests/legal.request';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthUser } = authUserUtilModule;

export class ConsentTypeController {
  constructor(
    private readonly listConsentTypes: ListConsentTypes,
    private readonly getConsentType: GetConsentType,
    private readonly createConsentType: CreateConsentType,
    private readonly updateConsentType: UpdateConsentType
  ) {}

  /** GET /legal/consent-types */
  list = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.listConsentTypes.execute({ actorId: requireAuthUser(req).userId, query: validQuery(req, ConsentTypeListQuery) });
    return ApiResponse.success(res, 'Tipos de consentimiento obtenidos exitosamente', result);
  });

  /** GET /legal/consent-types/:consentTypeId */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.getConsentType.execute({ actorId: requireAuthUser(req).userId, consentTypeId: routeParam(req, 'consentTypeId') });
    return ApiResponse.success(res, 'Tipo de consentimiento obtenido exitosamente', data);
  });

  /** POST /legal/consent-types (validate() ya dejó el body parseado) */
  create = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.createConsentType.execute({ actorId: requireAuthUser(req).userId, definition: req.body });
    return ApiResponse.success(res, 'Tipo de consentimiento creado exitosamente', data, 201);
  });

  /** PATCH /legal/consent-types/:consentTypeId */
  update = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.updateConsentType.execute({
      actorId: requireAuthUser(req).userId,
      consentTypeId: routeParam(req, 'consentTypeId'),
      patch: req.body
    });
    return ApiResponse.success(res, 'Tipo de consentimiento actualizado exitosamente', data);
  });
}
