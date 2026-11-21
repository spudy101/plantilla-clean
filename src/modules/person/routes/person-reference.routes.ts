// modules/client/kyc/routes/person-reference.routes.ts

import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { CreateReferenceBody, UpdateReferenceBody, ReferenceIdParams } from '../requests/person.request';
const router = express.Router();
import PersonReferenceController from '../controllers/person-reference.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import constantsModule from '../../../shared/constants';
const { CLIENT_ACCESS_ROLES } = constantsModule;

router.get(
  '/person/person-references',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  PersonReferenceController.list
);

router.post(
  '/person/person-references',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: CreateReferenceBody }),
  PersonReferenceController.create
);

router.put(
  '/person/person-references/:referenceId',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: ReferenceIdParams, body: UpdateReferenceBody }),
  PersonReferenceController.update
);

router.delete(
  '/person/person-references/:referenceId',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: ReferenceIdParams }),
  PersonReferenceController.remove
);

export default router;
