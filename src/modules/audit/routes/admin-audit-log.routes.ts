import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { AuditLogListQuery, AuditLogExportQuery, AuditLogIdParams } from '../requests/audit.request';
const router = express.Router();
import AdminAuditLogController from '../controllers/admin-audit-log.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import constantsModule from '../../../shared/constants';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

router.get(
  '/audit/audit-logs',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.GLOBAL_LOGS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: AuditLogListQuery }),
  AdminAuditLogController.list
);

router.get(
  '/audit/audit-logs/export',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.GLOBAL_LOGS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  validate({ query: AuditLogExportQuery }),
  AdminAuditLogController.exportLogs
);

router.get(
  '/audit/audit-logs/:auditLogId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.GLOBAL_LOGS, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: AuditLogIdParams }),
  AdminAuditLogController.getById
);

export default router;
