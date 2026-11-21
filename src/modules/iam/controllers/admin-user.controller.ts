// modules/admin/users/controllers/admin-user.controller.ts

import AdminUserService from '../services/admin-user.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/presentation/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;
import auditModule from '../../audit';
import { validQuery } from '../../../shared/presentation/validation/validate';
import { InternalUserDeletedListQuery, InternalUserListQuery, UserChangeLogsQuery } from '../requests/iam.request';
const { adminAuditContextUtil: adminAuditContextUtilModule } = auditModule;
const { adminAuditContext } = adminAuditContextUtilModule;

class AdminUserController {
  /** GET /admin/api/users */
  list = asyncHandler(async (req, res) => {
    const result = await AdminUserService.list(validQuery(req, InternalUserListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Usuarios internos obtenidos exitosamente', result);
  });

  /** GET /admin/api/users/deleted — listado histórico de usuarios internos eliminados (read-only) */
  listDeleted = asyncHandler(async (req, res) => {
    const result = await AdminUserService.listDeleted(validQuery(req, InternalUserDeletedListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Usuarios internos eliminados obtenidos exitosamente', result);
  });

  /** GET /admin/api/users/roles — catálogo de roles internos para el filtro del listado */
  listRoleOptions = asyncHandler(async (req, res) => {
    const data = await AdminUserService.listRoleOptions(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Roles internos obtenidos exitosamente', data);
  });

  /** GET /admin/api/users/:userId */
  getById = asyncHandler(async (req, res) => {
    const data = await AdminUserService.getById(routeParam(req, 'userId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Usuario interno obtenido exitosamente', data);
  });

  /** POST /admin/api/users */
  create = asyncHandler(async (req, res) => {
    const data = await AdminUserService.create(req.body, adminAuditContext(req, res));
    return ApiResponse.created(res, 'Usuario interno creado exitosamente', data);
  });

  /** PATCH /admin/api/users/:userId */
  update = asyncHandler(async (req, res) => {
    const data = await AdminUserService.update(routeParam(req, 'userId'), req.body, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Usuario interno actualizado exitosamente', data);
  });

  /** PATCH /admin/api/users/:userId/role */
  changeRole = asyncHandler(async (req, res) => {
    const result = await AdminUserService.changeRole(routeParam(req, 'userId'), req.body.roleId, adminAuditContext(req, res));
    if (result && 'pending' in result && result.pending) {
      return ApiResponse.accepted(res, 'Cambio de rol pendiente de segunda aprobación', result.approvalRequest);
    }
    return ApiResponse.success(res, 'Rol actualizado exitosamente', result);
  });

  /** PATCH /admin/api/users/:userId/status */
  changeStatus = asyncHandler(async (req, res) => {
    const data = await AdminUserService.setStatus(routeParam(req, 'userId'), req.body.isActive, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Estado del usuario actualizado exitosamente', data);
  });

  /** DELETE /admin/api/users/:userId/delete-account */
  deleteUser = asyncHandler(async (req, res) => {
    const result = await AdminUserService.deleteUser(routeParam(req, 'userId'), req.body.currentPassword, adminAuditContext(req, res));
    if (result?.pending) {
      return ApiResponse.accepted(res, 'Eliminación pendiente de segunda aprobación', result.approvalRequest);
    }
    return ApiResponse.success(res, 'Usuario interno eliminado exitosamente', result);
  });

  /** GET /admin/api/users/:userId/sessions */
  listSessions = asyncHandler(async (req, res) => {
    const data = await AdminUserService.listSessions(routeParam(req, 'userId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesiones obtenidas exitosamente', data);
  });

  /** DELETE /admin/api/users/:userId/sessions */
  closeSessions = asyncHandler(async (req, res) => {
    const data = await AdminUserService.closeSessions(routeParam(req, 'userId'), adminAuditContext(req, res));
    return ApiResponse.success(res, 'Sesiones cerradas exitosamente', data);
  });

  /** GET /admin/api/users/:userId/change-logs */
  listChangeLogs = asyncHandler(async (req, res) => {
    const data = await AdminUserService.listChangeLogs(routeParam(req, 'userId'), validQuery(req, UserChangeLogsQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Bitácora obtenida exitosamente', data);
  });
}


export default new AdminUserController();
