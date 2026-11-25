import express from 'express';
import type { Router } from 'express';
import type { AuthLoginController } from './auth.controllers';
import type { AuthGuards } from './auth.guards';
import { validate } from '../../../../shared/presentation/validation/validate';
import { ClientTypeHeaders, LoginBody, VerifyMfaBody, RefreshTokenHeaders, SessionIdParams, DeviceIdParams, RenameDeviceBody } from './requests/iam.request';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';

// ============================================================
// PUBLIC
// ============================================================

export function createAuthLoginRouter(controller: AuthLoginController, guards: AuthGuards): Router {
  const router = express.Router();

  router.post(
    '/login',
    guards.loginIpLimiter(),
    RateLimitMiddleware.authLimiter(),
    RequestLockMiddleware.forPublicEndpoints(),
    validate({ headers: ClientTypeHeaders, body: LoginBody }),
    controller.login
  );

  router.post(
    '/verify-mfa',
    RateLimitMiddleware.authLimiter(),
    RequestLockMiddleware.forPublicEndpoints(),
    validate({ headers: ClientTypeHeaders, body: VerifyMfaBody }),
    controller.verifyMFA
  );

  // El access token puede estar expirado — la autenticación aquí es el refresh token mismo.
  // No se usa guards.authenticate ni RequestLockMiddleware.forAuthenticatedUsers.
  //
  // El limiter y el lock son los propios del refresh, agrupados por SESIÓN. Los genéricos agrupan por
  // IP (authLimiter cae a `ip:` porque el token viaja en cookie, no en el body), y este endpoint se
  // llama en bucle por diseño: detrás de una IP pública conviven varios usuarios que se consumían el
  // cupo —y se bloqueaban el lock— entre sí, quedándose sin poder renovar la sesión.
  router.post(
    '/refresh',
    RateLimitMiddleware.refreshLimiter(),
    RequestLockMiddleware.forRefresh(),
    validate({ headers: RefreshTokenHeaders }),
    controller.refreshToken
  );

  // === RF-AUTH-03: Gestión de Dispositivos Autenticados y Control de Sesiones ===

  // ============================================================
  // PROTECTED — sesión
  // ============================================================

  router.post(
    '/logout',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.logout
  );

  router.post(
    '/logout-all',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.logoutAll
  );

  /**
   * POST /auth/logout-others
   * Cierra todas las sesiones activas excepto la actual.
   */
  // [RF-AUTH-03] | CA-02 | Cierra todas las sesiones salvo la actual
  router.post(
    '/logout-others',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.logoutOthers
  );

  /**
   * DELETE /auth/sessions/:sessionId
   * Cierra una sesión específica que no sea la actual.
   */
  // [RF-AUTH-03] | CA-02 | Cierra sesión individual por ID
  router.delete(
    '/sessions/:sessionId',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: SessionIdParams }),
    controller.closeSession
  );

  addDeviceRoutes(router, controller, guards);

  return router;
}

/** Los dispositivos de confianza del usuario (RF-AUTH-03). */
function addDeviceRoutes(router: Router, controller: AuthLoginController, guards: AuthGuards) {
  // ============================================================
  // PROTECTED — dispositivos
  // ============================================================

  /**
   * GET /auth/devices
   * Lista todos los dispositivos del usuario (todos los estados).
   */
  // [RF-AUTH-03] | CA-01 | Lista dispositivos activos del usuario autenticado
  router.get(
    '/devices',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.getTrustedDevices
  );

  /**
   * GET /auth/devices/pending
   * Lista dispositivos pendientes de aprobación.
   * IMPORTANTE: debe ir antes de /devices/:deviceId para que Express
   * no lo interprete como parámetro.
   */
  router.get(
    '/devices/pending',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.getPendingDevices
  );

  /**
   * PATCH /auth/devices/:deviceId
   * Renombra un dispositivo. Cualquier dispositivo puede renombrarse a sí mismo.
   */
  router.patch(
    '/devices/:deviceId',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: DeviceIdParams, body: RenameDeviceBody }),
    controller.renameDevice
  );

  /**
   * POST /auth/devices/:deviceId/approve
   * Aprueba un dispositivo PENDING → TRUSTED.
   * Solo puede ejecutarse desde un dispositivo TRUSTED.
   */
  router.post(
    '/devices/:deviceId/approve',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: DeviceIdParams }),
    controller.approveDevice
  );

  /**
   * POST /auth/devices/:deviceId/block
   * Bloquea un dispositivo (trusted o pending) → BLOCKED.
   * Solo puede ejecutarse desde un dispositivo TRUSTED.
   * No se puede bloquear el único dispositivo trusted.
   */
  router.post(
    '/devices/:deviceId/block',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: DeviceIdParams }),
    controller.blockDevice
  );

  /**
   * POST /auth/devices/:deviceId/unblock
   * Desbloquea un dispositivo BLOCKED → PENDING (requiere re-aprobación).
   * Solo puede ejecutarse desde un dispositivo TRUSTED.
   */
  router.post(
    '/devices/:deviceId/unblock',
    guards.authenticate,
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ params: DeviceIdParams }),
    controller.unblockDevice
  );
}
