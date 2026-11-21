// modules/client/kyc/controllers/person-reference.controller.ts

import PersonReferenceService from '../services/person-reference.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/presentation/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
const { requireAuthPerson } = authUserUtilModule;

class PersonReferenceController {
  list = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const data = await PersonReferenceService.list(user.personId, user.userId);
    return ApiResponse.success(res, 'Referencias obtenidas exitosamente', data);
  });

  create = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const data = await PersonReferenceService.create(req.body, user.personId, user.userId);
    return ApiResponse.success(res, 'Referencia creada exitosamente', data, 201);
  });

  update = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    const data = await PersonReferenceService.update(routeParam(req, 'referenceId'), req.body, user.personId, user.userId);
    return ApiResponse.success(res, 'Referencia actualizada exitosamente', data);
  });

  remove = asyncHandler(async (req, res) => {
    const user = requireAuthPerson(req);
    await PersonReferenceService.remove(routeParam(req, 'referenceId'), user.personId, user.userId);
    return ApiResponse.success(res, 'Referencia eliminada exitosamente');
  });
}

export default new PersonReferenceController();
