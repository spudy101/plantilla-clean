import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { ChangeLogListQuery } from '../requests/audit.request';
const router = express.Router();
import ChangeLogController from '../controllers/admin-change-log.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import constantsModule from '../../../shared/infrastructure/config';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

router.get(
  '/audit/change-logs/users',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.USER_CHANGES, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: ChangeLogListQuery }),
  ChangeLogController.listUserChangeLogs
);

export default router;
