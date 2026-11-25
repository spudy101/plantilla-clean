// Rutas de gestión de USUARIOS INTERNOS (RF-ADM-01).
//
// Autorización: guards.authenticate (deja req.user con roleName) →
// guards.requirePermission(<módulo>, <acción>) → 403 si no procede.
// SUPERADMIN y ADMIN pasan por wildcard en la matriz RBAC.

import express from 'express';
import type { Router } from 'express';
import type { AdminUserController } from './admin.controllers';
import type { AuthGuards } from './auth.guards';
import { validate } from '../../../../shared/presentation/validation/validate';
import { InternalUserListQuery, InternalUserDeletedListQuery, CreateInternalUserBody, InternalUserIdParams, UpdateInternalUserBody, ChangeInternalRoleBody, ChangeStatusBody, DeleteInternalUserBody, UserChangeLogsQuery } from './requests/iam.request';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import rbacModule from '../../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

const M = RBAC_MODULES.INTERNAL_USERS;

// ── List ──────────────────────────────────────────────────────────────────

export function createAdminUserRouter(controller: AdminUserController, guards: AuthGuards): Router {
  const router = express.Router();
  /** Sesión, permiso RBAC sobre usuarios internos, límite y lock: lo mismo en todas las rutas. */
  const internalUsers = (action: string) => [
    guards.authenticate,
    guards.requirePermission(M, action),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers()
  ];

  router.get(
    '/iam/users',
    ...internalUsers(RBAC_ACTIONS.READ),
    validate({ query: InternalUserListQuery }),
    controller.list
  );

  // ── Create ────────────────────────────────────────────────────────────────
  router.post(
    '/iam/users',
    ...internalUsers(RBAC_ACTIONS.CREATE),
    validate({ body: CreateInternalUserBody }),
    controller.create
  );

  // ── Deleted list (histórico, read-only) ─────────────────────────────────────
  // Declarado ANTES de /iam/users/:userId para que 'deleted' no caiga en el param.
  router.get(
    '/iam/users/deleted',
    ...internalUsers(RBAC_ACTIONS.READ),
    validate({ query: InternalUserDeletedListQuery }),
    controller.listDeleted
  );

  // ── Roles disponibles para el filtro del listado (catálogo read-only) ────────
  // Declarado ANTES de /iam/users/:userId para que 'roles' no caiga en el param.
  // Solo roles internos (sin superadmin) — los mismos que filtra el listado.
  router.get(
    '/iam/users/roles',
    ...internalUsers(RBAC_ACTIONS.READ),
    controller.listRoleOptions
  );

  // ── Detail ────────────────────────────────────────────────────────────────
  router.get(
    '/iam/users/:userId',
    ...internalUsers(RBAC_ACTIONS.READ),
    validate({ params: InternalUserIdParams }),
    controller.getById
  );

  // ── Update (datos básicos) ──────────────────────────────────────────────────
  router.patch(
    '/iam/users/:userId',
    ...internalUsers(RBAC_ACTIONS.UPDATE),
    validate({ params: InternalUserIdParams }),
    validate({ body: UpdateInternalUserBody }),
    controller.update
  );

  // ── Asignar / cambiar rol (auditado) ────────────────────────────────────────
  router.patch(
    '/iam/users/:userId/role',
    ...internalUsers(RBAC_ACTIONS.UPDATE),
    validate({ params: InternalUserIdParams }),
    validate({ body: ChangeInternalRoleBody }),
    controller.changeRole
  );

  // ── Activar / desactivar (auditado) ─────────────────────────────────────────
  router.patch(
    '/iam/users/:userId/status',
    ...internalUsers(RBAC_ACTIONS.UPDATE),
    validate({ params: InternalUserIdParams }),
    validate({ body: ChangeStatusBody }),
    controller.changeStatus
  );

  // ── Eliminar usuario interno (ofuscación irreversible + doble aprobación) ─────
  // La contraseña del admin (maker) se valida en el service; la doble aprobación se
  // gatea a nivel de service (dualApproval.gate de approvals), no por middleware.
  router.delete(
    '/iam/users/:userId/delete-account',
    ...internalUsers(RBAC_ACTIONS.DELETE),
    validate({ params: InternalUserIdParams, body: DeleteInternalUserBody }),
    controller.deleteUser
  );

  // ── Sesiones del usuario ─────────────────────────────────────────────────────
  router.get(
    '/iam/users/:userId/sessions',
    ...internalUsers(RBAC_ACTIONS.READ),
    validate({ params: InternalUserIdParams }),
    controller.listSessions
  );

  router.delete(
    '/iam/users/:userId/sessions',
    ...internalUsers(RBAC_ACTIONS.DELETE),
    validate({ params: InternalUserIdParams }),
    controller.closeSessions
  );

  // ── Bitácora de cambios del usuario (auditoría) ─────────────────────────────
  router.get(
    '/iam/users/:userId/change-logs',
    ...internalUsers(RBAC_ACTIONS.READ),
    validate({ params: InternalUserIdParams }),
    validate({ query: UserChangeLogsQuery }),
    controller.listChangeLogs
  );

  return router;
}
