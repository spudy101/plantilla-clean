// === RF-AUTH-03 (admin): Gestión de Dispositivos Autenticados y Control de Sesiones ===

import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { AdminSessionListQuery, UserIdParams, SessionsByUserQuery, RevokeSessionParams, AttemptListQuery, AttemptsByUserQuery } from '../requests/iam.request';
const router = express.Router();
import AdminAuthSessionController from '../controllers/admin-auth-session.controller';
import AuthMiddleware from '../middlewares/auth.middleware';
import RbacMiddleware from '../middlewares/rbac.middleware';
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import constantsModule from '../../../shared/infrastructure/config';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

router.get(
  '/sessions',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: AdminSessionListQuery }),
  AdminAuthSessionController.listSessions
);

router.get(
  '/sessions/user/:userId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: UserIdParams, query: SessionsByUserQuery }),
  AdminAuthSessionController.getSessionsByUser
);

// Revocar sesión es una operación de escritura — Auditor no puede revocar
router.patch(
  '/sessions/:sessionId/revoke',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: RevokeSessionParams }),
  AdminAuthSessionController.revokeSession
);

router.get(
  '/attempts',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: AttemptListQuery }),
  AdminAuthSessionController.listAttempts
);

router.get(
  '/attempts/user/:userId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.ACTIVE_SESSIONS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: UserIdParams, query: AttemptsByUserQuery }),
  AdminAuthSessionController.getAttemptsByUser
);

export default router;
