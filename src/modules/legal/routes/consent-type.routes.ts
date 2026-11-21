import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { ConsentTypeListQuery, ConsentTypeIdParams, CreateConsentTypeBody, UpdateConsentTypeBody } from '../requests/legal.request';
const router = express.Router();
import ConsentTypeController from '../controllers/consent-type.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import rbacModule from '../../../shared/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

router.get(
  '/legal/consent-types',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.CONSENT_TYPES, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: ConsentTypeListQuery }),
  ConsentTypeController.list
);

router.get(
  '/legal/consent-types/:consentTypeId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.CONSENT_TYPES, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: ConsentTypeIdParams }),
  ConsentTypeController.getById
);

router.post(
  '/legal/consent-types',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.CONSENT_TYPES, RBAC_ACTIONS.CREATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: CreateConsentTypeBody }),
  ConsentTypeController.create
);

router.patch(
  '/legal/consent-types/:consentTypeId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.CONSENT_TYPES, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: ConsentTypeIdParams, body: UpdateConsentTypeBody }),
  ConsentTypeController.update
);

export default router;
