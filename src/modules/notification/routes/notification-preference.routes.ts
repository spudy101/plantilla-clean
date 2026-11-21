import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { UpdatePreferenceBody } from '../requests/notification.request';
const router = express.Router();
import NotificationPreferenceController from '../controllers/notification-preference.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';

// Una sola preferencia por usuario (canales + horario de silencio). Todas requieren autenticación.

/** GET /person/notifications/preferences */
router.get(
  '/person/notifications/preferences',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  NotificationPreferenceController.getPreference
);

/** PUT /person/notifications/preferences */
router.put(
  '/person/notifications/preferences',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: UpdatePreferenceBody }),
  NotificationPreferenceController.updatePreference
);

export default router;
