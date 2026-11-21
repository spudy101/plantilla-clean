// modules/admin/rbac/routes/admin-rbac.routes.ts
//
// Catálogo RBAC de solo lectura + gestión de overrides en runtime (RF-ADM-01).
//   GET    /admin/api/rbac/modules                               → catálogo módulos + acciones
//   GET    /admin/api/rbac/roles                                 → matriz de roles con permisos
//   GET    /admin/api/rbac/me                                    → permisos efectivos del autenticado
//   GET    /admin/api/rbac/roles/:roleName/permissions           → listar overrides del rol
//   POST   /admin/api/rbac/roles/:roleName/permissions           → otorgar permiso
//   DELETE /admin/api/rbac/roles/:roleName/permissions/:id       → revocar permiso

import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { RoleNameParams, PermissionIdParams, GrantPermissionBody } from '../requests/iam.request';
const router = express.Router();
import AdminRbacController from '../controllers/admin-rbac.controller';
import AuthMiddleware from '../middlewares/auth.middleware';
import RbacMiddleware from '../middlewares/rbac.middleware';
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import constantsModule from '../../../shared/constants';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

// ── Catálogo: lectura sobre el módulo admin ─────────────────────────────────
router.get(
  '/iam/rbac/modules',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  AdminRbacController.getCatalog
);

router.get(
  '/iam/rbac/roles',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  AdminRbacController.getRoles
);

// ── Permisos del usuario autenticado ─────────────────────────────────────────
// DELIBERADO: sin requirePermission — todo admin autenticado consulta SUS PROPIOS permisos
// efectivos (el front arma su menú con esto). No expone datos de terceros ni de otros roles.
router.get(
  '/iam/rbac/me',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  AdminRbacController.getMyPermissions
);

// ── Gestión de overrides (solo SUPERADMIN llega por wildcard) ─────────────────
router.get(
  '/iam/rbac/roles/:roleName/permissions',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  validate({ params: RoleNameParams }),
  AdminRbacController.listOverrides
);

router.post(
  '/iam/rbac/roles/:roleName/permissions',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.CREATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: RoleNameParams, body: GrantPermissionBody }),
  AdminRbacController.grantPermission
);

router.delete(
  '/iam/rbac/roles/:roleName/permissions/:permissionId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.DELETE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: RoleNameParams }),
  validate({ params: PermissionIdParams }),
  AdminRbacController.revokePermission
);

export default router;
