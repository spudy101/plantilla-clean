import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { RecentActivityQuery } from '../requests/audit.request';
const router = express.Router();
import UserActivityController from '../controllers/user-activity.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import constantsModule from '../../../shared/constants';
const { CLIENT_ACCESS_ROLES } = constantsModule;

// Feed de actividad reciente del PROPIO usuario (client-safe). Lectura: sin request lock.
router.get(
  '/audit/recent-activity',
  AuthMiddleware.requireRole(CLIENT_ACCESS_ROLES),
  RateLimitMiddleware.apiLimiter(),
  validate({ query: RecentActivityQuery }),
  UserActivityController.list
);

export default router;
