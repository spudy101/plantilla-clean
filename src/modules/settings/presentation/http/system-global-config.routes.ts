// Rutas HTTP de settings: URL, método y middlewares. El router se ARMA (factory) con lo que recibe; no
// importa el módulo iam ni crea el controlador: eso lo hace settings.module.ts.
import express from 'express';
import type { Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import { UpdateSystemGlobalConfigBody } from './requests/update-system-global-config.request';
import type { SystemGlobalConfigController } from './system-global-config.controller';

const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

export function createSystemGlobalConfigRouter(controller: SystemGlobalConfigController, guards: RouteGuards): Router {
  const router = express.Router();

  // Lectura — Superadmin y Auditor (y cualquier rol con SYSTEM_CONFIG.READ)
  router.get(
    '/system-config',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.SYSTEM_CONFIG, RBAC_ACTIONS.READ),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.getConfig
  );

  // Escritura — solo roles con SYSTEM_CONFIG.UPDATE (SUPERADMIN)
  router.patch(
    '/system-config',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.SYSTEM_CONFIG, RBAC_ACTIONS.UPDATE),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: UpdateSystemGlobalConfigBody }),
    controller.updateConfig
  );

  return router;
}
