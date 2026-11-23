// Rutas admin del monitoreo de proveedores externos (RBAC: módulo providers, solo lectura). El router se arma
// con el controlador y las guardas que recibe: no importa el módulo iam.
import express from 'express';
import type { Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import { FallbackQuery } from './requests/integration-monitoring.request';
import type { IntegrationMonitoringController } from './integration-monitoring.controller';

const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

export function createIntegrationMonitoringRouter(controller: IntegrationMonitoringController, guards: RouteGuards): Router {
  const router = express.Router();
  const protect = () => [
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.PROVIDERS, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers()
  ];

  // GET /api/v1/integration/providers/health — semáforo del circuit breaker por producto.
  router.get('/providers/health', ...protect(), controller.health);

  // GET /api/v1/integration/fallbacks — historial de ventanas de fallback (con duración).
  router.get('/fallbacks', ...protect(), validate({ query: FallbackQuery }), controller.fallbacks);

  return router;
}
