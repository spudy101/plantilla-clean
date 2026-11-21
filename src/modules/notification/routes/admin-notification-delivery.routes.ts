import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { DeliveryListQuery, DeliveryIdParams } from '../requests/notification.request';

const router = express.Router();
import AdminNotificationDeliveryController from '../controllers/admin-notification-delivery.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import constantsModule from '../../../shared/infrastructure/config';
const { RBAC_MODULES, RBAC_ACTIONS } = constantsModule;

// Consulta de entregas (solo lectura: los reintentos son automáticos).

// GET /api/notification-delivery
router.get(
  '/notification-delivery',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_DELIVERIES, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  validate({ query: DeliveryListQuery }),
  AdminNotificationDeliveryController.list
);

// GET /api/notification-delivery/:id
router.get(
  '/notification-delivery/:id',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_DELIVERIES, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  validate({ params: DeliveryIdParams }),
  AdminNotificationDeliveryController.getById
);

export default router;
