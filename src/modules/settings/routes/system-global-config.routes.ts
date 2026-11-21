import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { UpdateSystemGlobalConfigBody } from '../requests/system-global-config.request';
const router = express.Router();
import SystemGlobalConfigController from '../controllers/system-global-config.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import rbacModule from '../../../shared/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

// Lectura — Superadmin y Auditor (y cualquier rol con ADMIN.READ)
router.get(
  '/system-config',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.SYSTEM_CONFIG, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  SystemGlobalConfigController.getConfig
);

// Escritura — solo roles con ADMIN.UPDATE (SUPERADMIN)
router.patch(
  '/system-config',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.SYSTEM_CONFIG, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: UpdateSystemGlobalConfigBody }),
  SystemGlobalConfigController.updateConfig
);

export default router;
