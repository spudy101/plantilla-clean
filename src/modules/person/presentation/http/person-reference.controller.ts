// Controlador HTTP de las referencias personales del titular (portal cliente).
import type { Request, Response } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import type {
  CreateReference,
  ListReferences,
  RemoveReference,
  UpdateReference
} from '../../application/use-cases/person-references.use-cases';

const { asyncHandler } = errorMiddlewareModule;
const { routeParam } = routeParamUtilModule;
const { requireAuthPerson } = authUserUtilModule;

export interface PersonReferenceUseCases {
  list: ListReferences;
  create: CreateReference;
  update: UpdateReference;
  remove: RemoveReference;
}

export class PersonReferenceController {
  constructor(private readonly useCases: PersonReferenceUseCases) {}

  list = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId } = requireAuthPerson(req);
    const data = await this.useCases.list.execute({ userId, personId });
    return ApiResponse.success(res, 'Referencias obtenidas exitosamente', data);
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId } = requireAuthPerson(req);
    const data = await this.useCases.create.execute({ userId, personId, data: req.body });
    return ApiResponse.success(res, 'Referencia creada exitosamente', data, 201);
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId } = requireAuthPerson(req);
    const data = await this.useCases.update.execute({ userId, personId, referenceId: routeParam(req, 'referenceId'), changes: req.body });
    return ApiResponse.success(res, 'Referencia actualizada exitosamente', data);
  });

  remove = asyncHandler(async (req: Request, res: Response) => {
    const { userId, personId } = requireAuthPerson(req);
    await this.useCases.remove.execute({ userId, personId, referenceId: routeParam(req, 'referenceId') });
    return ApiResponse.success(res, 'Referencia eliminada exitosamente');
  });
}
