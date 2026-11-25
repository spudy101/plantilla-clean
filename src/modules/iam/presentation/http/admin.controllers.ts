// Controladores HTTP del panel admin de iam: sesiones e intentos de autenticación, usuarios internos y RBAC. El
// funcionario sale de la sesión (req.user) y del contexto de auditoría; no tienen reglas.
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import adminAuditContextUtilModule from '../../../../shared/presentation/http/admin-audit-context.util';
import { validQuery } from '../../../../shared/presentation/validation/validate';
import type {
  ListAuthAttempts,
  ListSessions,
  ListUserAuthAttempts,
  ListUserSessions,
  RevokeSession
} from '../../application/use-cases/admin-sessions.use-cases';
import type {
  ChangeInternalRole,
  CloseInternalUserSessions,
  CreateInternalUser,
  DeleteInternalUser,
  GetInternalUser,
  ListDeletedInternalUsers,
  ListInternalRoleOptions,
  ListInternalUserChangeLogs,
  ListInternalUsers,
  ListInternalUserSessions,
  SetInternalUserStatus,
  UpdateInternalUser
} from '../../application/use-cases/internal-users.use-cases';
import type {
  GetEffectivePermissions,
  GetRbacCatalog,
  GetRoleMatrix,
  GrantPermission,
  ListPermissionOverrides,
  RevokePermission
} from '../../application/use-cases/rbac.use-cases';
import {
  AdminSessionListQuery,
  AttemptListQuery,
  AttemptsByUserQuery,
  InternalUserDeletedListQuery,
  InternalUserListQuery,
  SessionsByUserQuery,
  UserChangeLogsQuery
} from './requests/iam.request';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtilModule;
const { routeParam } = routeParamUtilModule;
const { adminAuditContext } = adminAuditContextUtilModule;

// ============================================================
// SESIONES E INTENTOS
// ============================================================

export interface AdminSessionUseCases {
  list: ListSessions;
  listByUser: ListUserSessions;
  revoke: RevokeSession;
  listAttempts: ListAuthAttempts;
  listAttemptsByUser: ListUserAuthAttempts;
}

export class AdminAuthSessionController {
  constructor(private readonly useCases: AdminSessionUseCases) {}

  listSessions = asyncHandler(async (req, res) => {
    const result = await this.useCases.list.execute(validQuery(req, AdminSessionListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesiones obtenidas exitosamente', result);
  });

  getSessionsByUser = asyncHandler(async (req, res) => {
    const result = await this.useCases.listByUser.execute(
      routeParam(req, 'userId'),
      validQuery(req, SessionsByUserQuery),
      requireAuthUser(req).userId
    );
    return ApiResponse.success(res, 'Sesiones del usuario obtenidas exitosamente', result);
  });

  revokeSession = asyncHandler(async (req, res) => {
    const result = await this.useCases.revoke.execute(routeParam(req, 'sessionId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesión revocada exitosamente', result);
  });

  listAttempts = asyncHandler(async (req, res) => {
    const result = await this.useCases.listAttempts.execute(validQuery(req, AttemptListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Intentos de autenticación obtenidos exitosamente', result);
  });

  getAttemptsByUser = asyncHandler(async (req, res) => {
    const result = await this.useCases.listAttemptsByUser.execute(
      routeParam(req, 'userId'),
      validQuery(req, AttemptsByUserQuery),
      requireAuthUser(req).userId
    );
    return ApiResponse.success(res, 'Intentos del usuario obtenidos exitosamente', result);
  });
}

// ============================================================
// USUARIOS INTERNOS
// ============================================================

export interface InternalUserUseCases {
  list: ListInternalUsers;
  listDeleted: ListDeletedInternalUsers;
  listRoleOptions: ListInternalRoleOptions;
  get: GetInternalUser;
  create: CreateInternalUser;
  update: UpdateInternalUser;
  changeRole: ChangeInternalRole;
  setStatus: SetInternalUserStatus;
  delete: DeleteInternalUser;
  listSessions: ListInternalUserSessions;
  closeSessions: CloseInternalUserSessions;
  listChangeLogs: ListInternalUserChangeLogs;
}

export class AdminUserController {
  constructor(private readonly useCases: InternalUserUseCases) {}

  /** GET /users */
  list = asyncHandler(async (req, res) => {
    const result = await this.useCases.list.execute(validQuery(req, InternalUserListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Usuarios internos obtenidos exitosamente', result);
  });

  /** GET /users/deleted — histórico de internos eliminados (solo lectura) */
  listDeleted = asyncHandler(async (req, res) => {
    const result = await this.useCases.listDeleted.execute(validQuery(req, InternalUserDeletedListQuery), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Usuarios internos eliminados obtenidos exitosamente', result);
  });

  /** GET /users/roles — roles internos para el filtro del listado */
  listRoleOptions = asyncHandler(async (req, res) => {
    const data = await this.useCases.listRoleOptions.execute(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Roles internos obtenidos exitosamente', data);
  });

  /** GET /users/:userId */
  getById = asyncHandler(async (req, res) => {
    const data = await this.useCases.get.execute(routeParam(req, 'userId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Usuario interno obtenido exitosamente', data);
  });

  /** POST /users */
  create = asyncHandler(async (req, res) => {
    const data = await this.useCases.create.execute(req.body, adminAuditContext(req, res));
    return ApiResponse.created(res, 'Usuario interno creado exitosamente', data);
  });

  /** PATCH /users/:userId */
  update = asyncHandler(async (req, res) => {
    const data = await this.useCases.update.execute(routeParam(req, 'userId'), req.body, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Usuario interno actualizado exitosamente', data);
  });

  /** PATCH /users/:userId/role */
  changeRole = asyncHandler(async (req, res) => {
    const result = await this.useCases.changeRole.execute(routeParam(req, 'userId'), req.body.roleId, adminAuditContext(req, res));
    if (result && 'pending' in result && result.pending) {
      return ApiResponse.accepted(res, 'Cambio de rol pendiente de segunda aprobación', result.approvalRequest);
    }
    return ApiResponse.success(res, 'Rol actualizado exitosamente', result);
  });

  /** PATCH /users/:userId/status */
  changeStatus = asyncHandler(async (req, res) => {
    const data = await this.useCases.setStatus.execute(routeParam(req, 'userId'), req.body.isActive, adminAuditContext(req, res));
    return ApiResponse.success(res, 'Estado del usuario actualizado exitosamente', data);
  });

  /** DELETE /users/:userId/delete-account */
  deleteUser = asyncHandler(async (req, res) => {
    const result = await this.useCases.delete.execute(routeParam(req, 'userId'), req.body.currentPassword, adminAuditContext(req, res));
    if ('pending' in result && result.pending) {
      return ApiResponse.accepted(res, 'Eliminación pendiente de segunda aprobación', result.approvalRequest);
    }
    return ApiResponse.success(res, 'Usuario interno eliminado exitosamente', result);
  });

  /** GET /users/:userId/sessions */
  listSessions = asyncHandler(async (req, res) => {
    const data = await this.useCases.listSessions.execute(routeParam(req, 'userId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Sesiones obtenidas exitosamente', data);
  });

  /** DELETE /users/:userId/sessions */
  closeSessions = asyncHandler(async (req, res) => {
    const data = await this.useCases.closeSessions.execute(routeParam(req, 'userId'), adminAuditContext(req, res));
    return ApiResponse.success(res, 'Sesiones cerradas exitosamente', data);
  });

  /** GET /users/:userId/change-logs */
  listChangeLogs = asyncHandler(async (req, res) => {
    const data = await this.useCases.listChangeLogs.execute(
      routeParam(req, 'userId'),
      validQuery(req, UserChangeLogsQuery),
      requireAuthUser(req).userId
    );
    return ApiResponse.success(res, 'Bitácora obtenida exitosamente', data);
  });
}

// ============================================================
// RBAC
// ============================================================

export interface RbacUseCases {
  catalog: GetRbacCatalog;
  matrix: GetRoleMatrix;
  effectivePermissions: GetEffectivePermissions;
  listOverrides: ListPermissionOverrides;
  grant: GrantPermission;
  revoke: RevokePermission;
}

export class AdminRbacController {
  constructor(private readonly useCases: RbacUseCases) {}

  /** GET /rbac/modules */
  getCatalog = asyncHandler((req, res) => {
    return ApiResponse.success(res, 'Catálogo RBAC obtenido exitosamente', this.useCases.catalog.execute(requireAuthUser(req).userId));
  });

  /** GET /rbac/roles */
  getRoles = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, 'Matriz de roles obtenida exitosamente', await this.useCases.matrix.execute(requireAuthUser(req).userId));
  });

  /** GET /rbac/me — permisos efectivos del usuario autenticado */
  getMyPermissions = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const data = await this.useCases.effectivePermissions.execute(user.roleName, user.userId);
    return ApiResponse.success(res, 'Permisos del usuario obtenidos exitosamente', data);
  });

  /** GET /rbac/roles/:roleName/permissions */
  listOverrides = asyncHandler(async (req, res) => {
    const data = await this.useCases.listOverrides.execute(routeParam(req, 'roleName'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Permisos adicionales obtenidos exitosamente', data);
  });

  /** POST /rbac/roles/:roleName/permissions */
  grantPermission = asyncHandler(async (req, res) => {
    const { moduleName, action } = req.body;
    const data = await this.useCases.grant.execute(routeParam(req, 'roleName'), moduleName, action, requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Permiso otorgado exitosamente', data, 201);
  });

  /** DELETE /rbac/roles/:roleName/permissions/:permissionId */
  revokePermission = asyncHandler(async (req, res) => {
    const data = await this.useCases.revoke.execute(routeParam(req, 'permissionId'), requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Permiso revocado exitosamente', data);
  });
}
