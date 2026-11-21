// Fase 5 — API admin de sesiones (traza forense). Dominio records/audit; mismo módulo RBAC (GLOBAL_LOGS)
// que gobierna /records/audit/audit-logs. Read-only.

import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { SessionListQuery, SessionIdParams, SessionTimelineQuery, SessionEntitiesQuery } from '../requests/audit.request';
const router = express.Router();
import AdminSessionTraceController from '../controllers/admin-session-trace.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import constantsModule from '../../../shared/infrastructure/config';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

router.get(
  '/audit/sessions',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.GLOBAL_LOGS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: SessionListQuery }),
  AdminSessionTraceController.list
);

router.get(
  '/audit/sessions/:sessionId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.GLOBAL_LOGS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: SessionIdParams, query: SessionTimelineQuery }),
  AdminSessionTraceController.timeline
);

router.get(
  '/audit/sessions/:sessionId/entities',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.GLOBAL_LOGS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: SessionIdParams, query: SessionEntitiesQuery }),
  AdminSessionTraceController.entities
);

export default router;
