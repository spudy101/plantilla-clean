import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { GrantConsentsBody, ConsentTypeIdParams, RevokeConsentBody } from '../requests/legal.request';
const router = express.Router();
import UserConsentController from '../controllers/user-consent.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import constantsModule from '../../../shared/constants';
const { CLIENT_ACCESS_ROLES } = constantsModule;

router.get(
  '/legal/consents',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  UserConsentController.getMyConsents
);

router.post(
  '/legal/consents/grant',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: GrantConsentsBody }),
  UserConsentController.grant
);

router.post(
  '/legal/consents/:consentTypeId/revoke',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: ConsentTypeIdParams, body: RevokeConsentBody }),
  UserConsentController.revokeMarketing
);

export default router;
