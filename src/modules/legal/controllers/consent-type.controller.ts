import ConsentTypeService from '../services/consent-type.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;
import auditModule from '../../audit';
import { validQuery } from '../../../shared/validation/validate';
import { ConsentTypeListQuery } from '../requests/legal.request';
const { adminAuditContextUtil: adminAuditContextUtilModule } = auditModule;
const { adminAuditContext } = adminAuditContextUtilModule;

class ConsentTypeController {
  list = asyncHandler(async (req, res) => {
    const result = await ConsentTypeService.list(validQuery(req, ConsentTypeListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Tipos de consentimiento obtenidos exitosamente', result);
  });

  getById = asyncHandler(async (req, res) => {
    const data = await ConsentTypeService.getById(routeParam(req, 'consentTypeId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Tipo de consentimiento obtenido exitosamente', data);
  });

  create = asyncHandler(async (req, res) => {
    const data = await ConsentTypeService.create(req.body, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Tipo de consentimiento creado exitosamente', data, 201);
  });

  update = asyncHandler(async (req, res) => {
    const data = await ConsentTypeService.update(routeParam(req, 'consentTypeId'), req.body, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Tipo de consentimiento actualizado exitosamente', data);
  });
}


export default new ConsentTypeController();
