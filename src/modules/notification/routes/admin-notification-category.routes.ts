import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { CategoryListQuery, CategoryIdParams, CreateCategoryBody, UpdateCategoryBody } from '../requests/notification.request';
const router = express.Router();
import NotificationCategoryController from '../controllers/admin-notification-category.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import rbacModule from '../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;


/** GET /admin/api/v1/notification/notification-categories */
router.get(
  '/notification-categories',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: CategoryListQuery }),
  NotificationCategoryController.list
);

/** GET /admin/api/v1/notification/notification-categories/:notificationCategoryId */
router.get(
  '/notification-categories/:notificationCategoryId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: CategoryIdParams }),
  NotificationCategoryController.getById
);

/** POST /admin/api/v1/notification/notification-categories */
router.post(
  '/notification-categories',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.CREATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: CreateCategoryBody }),
  NotificationCategoryController.create
);

/** PATCH /admin/api/v1/notification/notification-categories/:notificationCategoryId */
router.patch(
  '/notification-categories/:notificationCategoryId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: CategoryIdParams, body: UpdateCategoryBody }),
  NotificationCategoryController.update
);

/** DELETE /admin/api/v1/notification/notification-categories/:notificationCategoryId */
router.delete(
  '/notification-categories/:notificationCategoryId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.DELETE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: CategoryIdParams }),
  NotificationCategoryController.remove
);

export default router;
