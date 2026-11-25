// Rutas del módulo notification. Cada router se arma con su controlador y las guardas que recibe: no importa el
// módulo iam.
//
//   admin y client  bandeja, contador (también por SSE) y verificación de contacto   (/api/v1/notification)
//                   preferencias del titular                                         (/api/v1/kyc)
//                   creación por un servicio externo (X-API-Key)                     (/api/v1/notification)
//   admin           tipos, categorías y entregas, con permisos RBAC                   (/api/v1/notification)
//   client          webhook de rebotes de SES vía SNS                                 (/api/v1/notification)
import express from 'express';
import type { RequestHandler, Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import { idempotent } from '../../../../shared/presentation/http/idempotency/idempotency.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import {
  CategoryIdParams,
  CategoryListQuery,
  CreateCategoryBody,
  CreateNotificationBody,
  DeliveryIdParams,
  DeliveryListQuery,
  DirectNotificationBody,
  GlobalNotificationBody,
  GlobalNotificationListQuery,
  NotificationFeedQuery,
  PersonalNotificationListQuery,
  SendVerificationBody,
  TypeIdParams,
  TypeListQuery,
  UpdateCategoryBody,
  UpdatePreferenceBody,
  UpdateTypeBody,
  VerifyCodeBody
} from './requests/notification.request';
import type {
  BounceFeedController,
  NotificationCategoryController,
  NotificationController,
  NotificationDeliveryController,
  NotificationPreferenceController,
  NotificationTypeController,
  VerificationController
} from './notification.controllers';

const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

/** Las guardas de siempre más las de quien no es un usuario: otro sistema (X-API-Key) y el webhook de SNS. */
export interface NotificationRouteGuards extends RouteGuards {
  /** Un servicio externo con X-API-Key (deja req.externalService). */
  authenticateExternalService: RequestHandler;
  /** Un webhook con la apikey en la query. */
  authenticateWebhook: RequestHandler;
  /** Marca la operación en curso como llamada de un webhook (su traza la muestra así). */
  markWebhookOperation: RequestHandler;
}

/** SNS manda Content-Type text/plain: el express.json global no lo parsea, se toma el cuerpo crudo. */
const WEBHOOK_BODY_LIMIT = '256kb';

/** Bandeja, contador y creación externa (admin y client). */
export function createInboxRouter(controller: NotificationController, verification: VerificationController, guards: NotificationRouteGuards): Router {
  const router = express.Router();
  const user = () => [guards.authenticate, RateLimitMiddleware.apiLimiter(), RequestLockMiddleware.forAuthenticatedUsers()];

  // /count/stream antes que /count
  router.get('/count/stream', guards.authenticate, controller.streamUnreadCount);
  router.get('/count', guards.authenticate, RateLimitMiddleware.apiLimiter(), controller.getUnreadCount);

  // Lo llama otro sistema, que reintenta si se corta la respuesta: idempotente (Idempotency-Key obligatorio)
  router.post(
    '/notifications',
    guards.authenticateExternalService,
    validate({ body: CreateNotificationBody }),
    idempotent(),
    controller.createNotification
  );

  router.get('/notifications', ...user(), validate({ query: NotificationFeedQuery }), controller.getNotificationsList);
  router.get('/notifications/personal', ...user(), validate({ query: PersonalNotificationListQuery }), controller.getPersonalNotifications);
  router.get('/notifications/global', ...user(), validate({ query: GlobalNotificationListQuery }), controller.getGlobalNotifications);

  // Verificación de un contacto: rutas públicas
  const publicRoute = () => [RateLimitMiddleware.publicLimiter(), RequestLockMiddleware.forPublicEndpoints()];
  router.post('/send-verification', ...publicRoute(), validate({ body: SendVerificationBody }), verification.sendVerification);
  router.post('/verify-code', ...publicRoute(), validate({ body: VerifyCodeBody }), verification.verifyCode);
  return router;
}

/** Preferencia del titular (una por usuario): canales + horario de silencio. */
export function createPreferenceRouter(controller: NotificationPreferenceController, guards: RouteGuards): Router {
  const router = express.Router();
  const user = () => [guards.authenticate, RateLimitMiddleware.apiLimiter(), RequestLockMiddleware.forAuthenticatedUsers()];
  router.get('/person/notifications/preferences', ...user(), controller.getPreference);
  router.put('/person/notifications/preferences', ...user(), validate({ body: UpdatePreferenceBody }), controller.updatePreference);
  return router;
}

/** Panel admin: tipos, categorías y entregas. */
export function createNotificationAdminRouter(
  controllers: { types: NotificationTypeController; categories: NotificationCategoryController; deliveries: NotificationDeliveryController },
  guards: RouteGuards
): Router {
  const router = express.Router();
  const { types, categories, deliveries } = controllers;
  const managing = (action: string) => [
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, action),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers()
  ];

  // ── Tipos ──
  router.get('/notification-types', ...managing(RBAC_ACTIONS.READ), validate({ query: TypeListQuery }), types.list);
  // Envían a todos (o a un usuario): idempotentes para que un reintento o un doble clic no los mande dos veces.
  // idempotent() reemplaza al RequestLock (además de las simultáneas, cubre los reintentos posteriores). Antes
  // de /:notificationTypeId para que no se lean como un id.
  router.post(
    '/notification-types/global',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.CREATE),
    RateLimitMiddleware.apiLimiter(),
    validate({ body: GlobalNotificationBody }),
    idempotent(),
    types.createGlobalNotification
  );
  router.post(
    '/notification-types/direct',
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.NOTIFICATION_MANAGEMENT, RBAC_ACTIONS.CREATE),
    RateLimitMiddleware.apiLimiter(),
    validate({ body: DirectNotificationBody }),
    idempotent(),
    types.createDirectNotification
  );
  // Nombre, descripción y categoría (las plantillas son de solo lectura; canales y criticidad, de la categoría)
  router.patch(
    '/notification-types/:notificationTypeId',
    ...managing(RBAC_ACTIONS.UPDATE),
    validate({ params: TypeIdParams, body: UpdateTypeBody }),
    types.update
  );

  // ── Categorías ──
  router.get('/notification-categories', ...managing(RBAC_ACTIONS.READ), validate({ query: CategoryListQuery }), categories.list);
  router.get(
    '/notification-categories/:notificationCategoryId',
    ...managing(RBAC_ACTIONS.READ),
    validate({ params: CategoryIdParams }),
    categories.getById
  );
  router.post('/notification-categories', ...managing(RBAC_ACTIONS.CREATE), validate({ body: CreateCategoryBody }), categories.create);
  router.patch(
    '/notification-categories/:notificationCategoryId',
    ...managing(RBAC_ACTIONS.UPDATE),
    validate({ params: CategoryIdParams, body: UpdateCategoryBody }),
    categories.update
  );
  router.delete(
    '/notification-categories/:notificationCategoryId',
    ...managing(RBAC_ACTIONS.DELETE),
    validate({ params: CategoryIdParams }),
    categories.remove
  );

  // ── Entregas (solo lectura: los reintentos son automáticos) ──
  const reading = () => [guards.authenticate, guards.requirePermission(RBAC_MODULES.NOTIFICATION_DELIVERIES, RBAC_ACTIONS.READ), RateLimitMiddleware.apiLimiter()];
  router.get('/notification-delivery', ...reading(), validate({ query: DeliveryListQuery }), deliveries.list);
  router.get('/notification-delivery/:id', ...reading(), validate({ params: DeliveryIdParams }), deliveries.getById);
  return router;
}

/**
 * Feed de rebotes de SES (lo llama SNS, no un usuario): sin sesión ni RBAC. Se autentica por la apikey en la query
 * y, sobre todo, por la FIRMA del mensaje SNS (la verifica el caso de uso).
 */
export function createBounceWebhookRouter(controller: BounceFeedController, guards: NotificationRouteGuards): Router {
  const router = express.Router();
  router.post(
    '/email-bounces/webhook',
    guards.markWebhookOperation,
    express.text({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }),
    guards.authenticateWebhook,
    RateLimitMiddleware.apiLimiter(),
    controller.process
  );
  return router;
}
