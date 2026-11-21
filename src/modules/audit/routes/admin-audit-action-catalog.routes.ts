import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { AuditActionListQuery } from '../requests/audit.request';
const router = express.Router();
import AdminAuditActionCatalogController from '../controllers/admin-audit-action-catalog.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import constantsModule from '../../../shared/infrastructure/config';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

router.get(
  '/audit/audit-action-catalog/categories',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.AUDIT_ACTION_CATALOG, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  AdminAuditActionCatalogController.categories
);

router.get(
  '/audit/audit-action-catalog/risks',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.AUDIT_ACTION_CATALOG, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  AdminAuditActionCatalogController.risks
);

router.get(
  '/audit/audit-action-catalog/modules',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.AUDIT_ACTION_CATALOG, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  AdminAuditActionCatalogController.modules
);

router.get(
  '/audit/audit-action-catalog/actions',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.AUDIT_ACTION_CATALOG, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: AuditActionListQuery }),
  AdminAuditActionCatalogController.actions
);

export default router;
