import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { AuditAlertListQuery, AuditAlertIdParams, AcknowledgeAlertsBody } from '../requests/audit.request';
const router = express.Router();
import AdminAuditAlertController from '../controllers/admin-audit-alert.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import constantsModule from '../../../shared/infrastructure/config';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

router.get(
  '/audit/audit-alerts',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.SYSTEM_ALERTS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: AuditAlertListQuery }),
  AdminAuditAlertController.list
);

router.patch(
  '/audit/audit-alerts/:alertId/acknowledge',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.SYSTEM_ALERTS, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: AuditAlertIdParams }),
  AdminAuditAlertController.acknowledge
);

router.post(
  '/audit/audit-alerts/acknowledge-bulk',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.SYSTEM_ALERTS, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: AcknowledgeAlertsBody }),
  AdminAuditAlertController.acknowledgeBulk
);

export default router;
