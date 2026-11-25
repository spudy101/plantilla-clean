import express from 'express';
import type { Router } from 'express';
import type { AuthRegisterController } from './auth.controllers';
import { validate } from '../../../../shared/presentation/validation/validate';
import { RegisterHeaders, RegisterBody, RequestResetBody, ConfirmResetBody } from './requests/iam.request';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import PiiMaskingMiddleware from '../../../../shared/presentation/http/pii-masking.middleware';

// === RF-AUTH-01: Registro de Usuario (confirmación de correo y celular) ===

// ============================================================
// PUBLIC
// ============================================================

/**
 * POST /auth/register
 */
// [RF-AUTH-01] | CA-01, CA-02, CA-03, CA-05, CA-06, CA-07
// Endpoint principal de registro. Ver service para detalle
// por criterio.

export function createAuthRegisterRouter(controller: AuthRegisterController): Router {
  const router = express.Router();

  router.post(
    '/register',
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forPublicEndpoints(),
    // [RF-USR-01] | CA-06 | Exento del enmascaramiento global: durante el registro el usuario está
    // ingresando/confirmando sus propios datos y necesita verlos completos.
    PiiMaskingMiddleware.allowUnmasked(),
    validate({ headers: RegisterHeaders, body: RegisterBody }),
    controller.register
  );

  /**
   * POST /auth/reset-credentials/request
   */
  router.post(
    '/reset-credentials/request',
    RateLimitMiddleware.forgotPasswordLimiter(),
    RateLimitMiddleware.authLimiter(),
    RequestLockMiddleware.forPublicEndpoints(),
    validate({ body: RequestResetBody }),
    controller.requestResetCredentials
  );

  /**
   * POST /auth/reset-credentials/confirm
   */
  router.post(
    '/reset-credentials/confirm',
    RateLimitMiddleware.authLimiter(),
    RequestLockMiddleware.forPublicEndpoints(),
    validate({ body: ConfirmResetBody }),
    controller.confirmResetCredentials
  );

  return router;
}
