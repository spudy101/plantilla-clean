import express from 'express';
import { validate } from '../../../shared/presentation/validation/validate';
import { CreateNotificationBody, GlobalNotificationListQuery, NotificationFeedQuery, PersonalNotificationListQuery } from '../requests/notification.request';
const router = express.Router();
import NotificationController from '../controllers/notification.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import { idempotent } from '../../../shared/presentation/http/idempotency/idempotency.middleware';

/**
 * GET /count/stream debe ir ANTES de GET /count para que Express no lo confunda.
 */

/** GET /count/stream — SSE: stream de conteo en tiempo real */
router.get('/count/stream', AuthMiddleware.authenticate, NotificationController.streamUnreadCount);

/** GET /count — conteo puntual de no leídas */
router.get('/count', AuthMiddleware.authenticate, RateLimitMiddleware.apiLimiter(), NotificationController.getUnreadCount);

/**
 * POST / — creación externa vía X-API-Key. Idempotente (Idempotency-Key obligatorio): la llama otro
 * sistema, que reintenta si se corta la respuesta; sin la clave, cada reintento enviaría de nuevo.
 */
router.post(
  '/notifications',
  AuthMiddleware.externalAuthenticate,
  validate({ body: CreateNotificationBody }),
  idempotent(),
  NotificationController.createNotification
);

/** GET / — listado mixto (personal + global) paginado */
router.get(
  '/notifications',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: NotificationFeedQuery }),
  NotificationController.getNotificationsList
);

/** GET /personal — solo notificaciones personales */
router.get(
  '/notifications/personal',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: PersonalNotificationListQuery }),
  NotificationController.getPersonalNotifications
);

/** GET /global — solo notificaciones globales */
router.get(
  '/notifications/global',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ query: GlobalNotificationListQuery }),
  NotificationController.getGlobalNotifications
);

export default router;
