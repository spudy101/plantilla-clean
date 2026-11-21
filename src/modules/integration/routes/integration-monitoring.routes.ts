import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { FallbackQuery } from '../requests/integration-monitoring.request';

const router = express.Router();
import IntegrationMonitoringController from '../controllers/integration-monitoring.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import rbacModule from '../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

// GET /api/v1/integration/providers/health — semáforo del circuit breaker por producto.
router.get(
  '/providers/health',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PROVIDERS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  IntegrationMonitoringController.health
);

// GET /api/v1/integration/fallbacks — historial de ventanas de fallback (con duración).
router.get(
  '/fallbacks',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PROVIDERS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: FallbackQuery }),
  IntegrationMonitoringController.fallbacks
);

export default router;
