// === RF-AUTH-03 (admin): Gestión de Dispositivos Autenticados y Control de Sesiones ===

import express from 'express';
import type { Router } from 'express';
import type { AdminAuthSessionController } from './admin.controllers';
import type { AuthGuards } from './auth.guards';
import { validate } from '../../../../shared/presentation/validation/validate';
import { AdminSessionListQuery, UserIdParams, SessionsByUserQuery, RevokeSessionParams, AttemptListQuery, AttemptsByUserQuery } from './requests/iam.request';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import rbacModule from '../../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

export function createAdminAuthSessionRouter(controller: AdminAuthSessionController, guards: AuthGuards): Router {
  const router = express.Router();

  router.get(
    '/sessions',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ query: AdminSessionListQuery }),
    controller.listSessions
  );

  router.get(
    '/sessions/user/:userId',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: UserIdParams, query: SessionsByUserQuery }),
    controller.getSessionsByUser
  );

  // Revocar sesión es una operación de escritura — Auditor no puede revocar
  router.patch(
    '/sessions/:sessionId/revoke',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.UPDATE),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: RevokeSessionParams }),
    controller.revokeSession
  );

  router.get(
    '/attempts',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ query: AttemptListQuery }),
    controller.listAttempts
  );

  router.get(
    '/attempts/user/:userId',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: UserIdParams, query: AttemptsByUserQuery }),
    controller.getAttemptsByUser
  );

  return router;
}
