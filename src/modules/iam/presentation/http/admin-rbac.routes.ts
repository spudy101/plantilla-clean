// Catálogo RBAC de solo lectura + gestión de overrides en runtime (RF-ADM-01).
//   GET    /admin/api/rbac/modules                               → catálogo módulos + acciones
//   GET    /admin/api/rbac/roles                                 → matriz de roles con permisos
//   GET    /admin/api/rbac/me                                    → permisos efectivos del autenticado
//   GET    /admin/api/rbac/roles/:roleName/permissions           → listar overrides del rol
//   POST   /admin/api/rbac/roles/:roleName/permissions           → otorgar permiso
//   DELETE /admin/api/rbac/roles/:roleName/permissions/:id       → revocar permiso

import express from 'express';
import type { Router } from 'express';
import type { AdminRbacController } from './admin.controllers';
import type { AuthGuards } from './auth.guards';
import { validate } from '../../../../shared/presentation/validation/validate';
import { RoleNameParams, PermissionIdParams, GrantPermissionBody } from './requests/iam.request';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import rbacModule from '../../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

// ── Catálogo: lectura sobre el módulo admin ─────────────────────────────────

export function createAdminRbacRouter(controller: AdminRbacController, guards: AuthGuards): Router {
  const router = express.Router();

  router.get(
    '/iam/rbac/modules',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    controller.getCatalog
  );

  router.get(
    '/iam/rbac/roles',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    controller.getRoles
  );

  // ── Permisos del usuario autenticado ─────────────────────────────────────────
  // DELIBERADO: sin requirePermission — todo admin autenticado consulta SUS PROPIOS permisos
  // efectivos (el front arma su menú con esto). No expone datos de terceros ni de otros roles.
  router.get(
    '/iam/rbac/me',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    controller.getMyPermissions
  );

  // ── Gestión de overrides (solo SUPERADMIN llega por wildcard) ─────────────────
  router.get(
    '/iam/rbac/roles/:roleName/permissions',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    validate({ params: RoleNameParams }),
    controller.listOverrides
  );

  router.post(
    '/iam/rbac/roles/:roleName/permissions',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.CREATE),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: RoleNameParams, body: GrantPermissionBody }),
    controller.grantPermission
  );

  router.delete(
    '/iam/rbac/roles/:roleName/permissions/:permissionId',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ROLES_PERMISSIONS, RBAC_ACTIONS.DELETE),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: RoleNameParams }),
    validate({ params: PermissionIdParams }),
    controller.revokePermission
  );

  return router;
}
