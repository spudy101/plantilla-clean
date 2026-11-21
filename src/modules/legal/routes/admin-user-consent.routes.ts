import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { AdminUserConsentListQuery, UserIdParams, ConsentHistoryQuery } from '../requests/legal.request';
const router = express.Router();
import AdminUserConsentController from '../controllers/admin-user-consent.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import constantsModule from '../../../shared/infrastructure/config';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

router.get(
  '/legal/user-consents',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.POLICY_ACCEPTANCE, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: AdminUserConsentListQuery }),
  AdminUserConsentController.list
);

router.get(
  '/legal/user-consents/users/:userId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.POLICY_ACCEPTANCE, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: UserIdParams, query: ConsentHistoryQuery }),
  AdminUserConsentController.getHistoryByUser
);

export default router;
