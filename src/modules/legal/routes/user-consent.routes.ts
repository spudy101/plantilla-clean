import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { GrantConsentsBody, ConsentTypeIdParams, RevokeConsentBody } from '../requests/legal.request';
const router = express.Router();
import UserConsentController from '../controllers/user-consent.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import constantsModule from '../../../shared/infrastructure/config';
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
