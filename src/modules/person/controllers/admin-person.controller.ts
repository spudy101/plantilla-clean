import PersonService from '../services/admin-person.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;
import auditModule from '../../audit';
import { validQuery } from '../../../shared/validation/validate';
import { DeletedPersonListQuery, PersonListQuery } from '../requests/person.request';
const { adminAuditContextUtil: adminAuditContextUtilModule } = auditModule;
const { adminAuditContext } = adminAuditContextUtilModule;

class PersonController {
  /** GET /person */
  list = asyncHandler(async (req, res) => {
    const result = await PersonService.list(validQuery(req, PersonListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Usuarios obtenidos exitosamente', result);
  });

  /** GET /person/deleted — listado histórico de clientes eliminados (read-only) */
  listDeleted = asyncHandler(async (req, res) => {
    const result = await PersonService.listDeleted(validQuery(req, DeletedPersonListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Clientes eliminados obtenidos exitosamente', result);
  });

  /** GET /person/roles — catálogo de roles de cliente para el filtro del listado */
  listRoleOptions = asyncHandler(async (req, res) => {
    const data = await PersonService.listRoleOptions(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Roles de cliente obtenidos exitosamente', data);
  });

  /** GET /person/:userId */
  getById = asyncHandler(async (req, res) => {
    const data = await PersonService.getById(routeParam(req, 'userId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Detalle de usuario obtenido correctamente', data);
  });

  /** POST /person */
  create = asyncHandler(async (req, res) => {
    const auditContext = adminAuditContext(req, res);
    const data = await PersonService.create(req.body, auditContext);
    return ApiResponse.success(res, 'Usuario creado exitosamente', data, 201);
  });

  /** PUT /person/:userId/activate */
  activate = asyncHandler(async (req, res) => {
    const data = await PersonService.activate(routeParam(req, 'userId'), adminAuditContext(req, res));
    return ApiResponse.success(res, 'Usuario activado exitosamente', data);
  });

  /** PUT /person/:userId/deactivate */
  deactivate = asyncHandler(async (req, res) => {
    const data = await PersonService.deactivate(routeParam(req, 'userId'), adminAuditContext(req, res));
    return ApiResponse.success(res, 'Usuario desactivado exitosamente', data);
  });

  /** PUT /person/:userId/reset-password */
  resetPassword = asyncHandler(async (req, res) => {
    const data = await PersonService.resetPassword(routeParam(req, 'userId'), adminAuditContext(req, res));
    return ApiResponse.success(res, 'Contraseña reseteada exitosamente', data);
  });

  /** PUT /person/:userId/disable-mfa */
  disableMFA = asyncHandler(async (req, res) => {
    const data = await PersonService.disableMFA(routeParam(req, 'userId'), adminAuditContext(req, res));
    return ApiResponse.success(res, 'MFA desactivado exitosamente', data);
  });

  /** PUT /person/:userId/email */
  changeEmail = asyncHandler(async (req, res) => {
    const data = await PersonService.changeEmail(routeParam(req, 'userId'), req.body.newEmail, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Email actualizado exitosamente', data);
  });

  /** PUT /person/:userId/national-id */
  changeNationalId = asyncHandler(async (req, res) => {
    const data = await PersonService.changeNationalId(routeParam(req, 'userId'), req.body.newNationalId, adminAuditContext(req, res));
    return ApiResponse.success(res, 'National ID actualizado exitosamente', data);
  });

  /** PUT /person/:userId/role */
  changeRole = asyncHandler(async (req, res) => {
    const data = await PersonService.changeRole(routeParam(req, 'userId'), req.body.newRoleId, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Rol actualizado exitosamente', data);
  });

  /** DELETE /person/:userId/delete-account */
  deleteAccount = asyncHandler(async (req, res) => {
    const result = await PersonService.deleteAccount(routeParam(req, 'userId'), req.body.currentPassword, adminAuditContext(req, res));
    if (result?.pending) {
      return ApiResponse.accepted(res, 'Eliminación pendiente de segunda aprobación', result.approvalRequest);
    }
    return ApiResponse.success(res, 'Cuenta eliminada exitosamente');
  });
}


export default new PersonController();
