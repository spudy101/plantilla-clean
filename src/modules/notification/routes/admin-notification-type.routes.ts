// modules/admin/kyc/routes/admin-notification-type.routes.ts

import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { TypeListQuery, TypeIdParams, UpdateTypeBody, GlobalNotificationBody, DirectNotificationBody } from '../requests/notification.request';
const router = express.Router();
import NotificationTypeController from '../controllers/admin-notification-type.controller';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';
import { idempotent } from '../../../shared/http/idempotency/idempotency.middleware';
import rbacModule from '../../../shared/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

/**
 * GET /admin/api/kyc/notification-types
 * Lista paginada de tipos de notificación con templates completos
 * (titleTemplate, bodyTemplate, emailSubjectTemplate, emailBodyTemplate).
 * Filtros: isActive, notificationCategoryId.
 */
router.get(
  '/notification-types',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: TypeListQuery }),
  NotificationTypeController.list
);

/**
 * POST /admin/api/kyc/notification-types/global
 * Envía una notificación global a todos los usuarios del sistema.
 * La notificación se encola (processingStatus: 'queued') y se procesa en background.
 * Nota: va antes de /:notificationTypeId para que Express no lo interprete como ID.
 *
 * Body: { titulo, contenido, asunto }
 */
// Envía a todos los clientes: idempotente para que un reintento (o un doble clic) no la mande dos veces.
// idempotent() reemplaza al RequestLock: además de las simultáneas, cubre los reintentos posteriores.
router.post(
  '/notification-types/global',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.CREATE),
  RateLimitMiddleware.apiLimiter(),
  validate({ body: GlobalNotificationBody }),
  idempotent(),
  NotificationTypeController.createGlobalNotification
);

/**
 * POST /admin/api/kyc/notification-types/direct
 * Envía una notificación a un usuario específico (no global).
 * La notificación se encola (processingStatus: 'queued') y se procesa en background.
 * Nota: va antes de /:notificationTypeId para que Express no lo interprete como ID.
 *
 * Body: { userId, titulo, contenido, asunto }
 */
router.post(
  '/notification-types/direct',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.CREATE),
  RateLimitMiddleware.apiLimiter(),
  validate({ body: DirectNotificationBody }),
  idempotent(),
  NotificationTypeController.createDirectNotification
);

/**
 * PATCH /admin/api/kyc/notification-types/:notificationTypeId
 * Actualiza los templates de un tipo de notificación existente.
 * Campos editables: name, description, notificationCategoryId,
 * title_template, body_template, email_subject_template, email_body_template.
 * (Los canales — push/email/sms — y la criticidad viven en la categoría, no en el tipo.)
 *
 * Body: { [campo]: valor, ... } (todos opcionales — solo se actualizan los enviados)
 */
router.patch(
  '/notification-types/:notificationTypeId',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ params: TypeIdParams, body: UpdateTypeBody }),
  NotificationTypeController.update
);

export default router;
