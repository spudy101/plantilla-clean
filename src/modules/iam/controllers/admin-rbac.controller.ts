// modules/admin/rbac/controllers/admin-rbac.controller.ts

import AdminRbacService from '../services/admin-rbac.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;

class AdminRbacController {
  /** GET /admin/api/rbac/modules */
  getCatalog = asyncHandler((req, res) => {
    return ApiResponse.success(res, 'Catálogo RBAC obtenido exitosamente', AdminRbacService.getCatalog(requireAuthUser(req).userId));
  });

  /** GET /admin/api/rbac/roles */
  getRoles = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Matriz de roles obtenida exitosamente', await AdminRbacService.getRoles(requireAuthUser(req).userId));
  });

  /** GET /admin/api/rbac/me — permisos efectivos del usuario autenticado */
  getMyPermissions = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const data = await AdminRbacService.getEffectivePermissions(user.roleName, user.userId);
    return ApiResponse.success(res, 'Permisos del usuario obtenidos exitosamente', data);
  });

  /** GET /admin/api/rbac/roles/:roleName/permissions */
  listOverrides = asyncHandler(async (req, res) => {
    const data = await AdminRbacService.listOverrides(routeParam(req, 'roleName'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Permisos adicionales obtenidos exitosamente', data);
  });

  /** POST /admin/api/rbac/roles/:roleName/permissions */
  grantPermission = asyncHandler(async (req, res) => {
    const { moduleName, action } = req.body;
    const data = await AdminRbacService.grantPermission(routeParam(req, 'roleName'), moduleName, action, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Permiso otorgado exitosamente', data, 201);
  });

  /** DELETE /admin/api/rbac/roles/:roleName/permissions/:permissionId */
  revokePermission = asyncHandler(async (req, res) => {
    const data = await AdminRbacService.revokePermission(routeParam(req, 'permissionId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Permiso revocado exitosamente', data);
  });
}

export default new AdminRbacController();
