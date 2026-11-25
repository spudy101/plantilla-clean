import express from 'express';
import type { Router } from 'express';
import type { MfaController } from './auth.controllers';
import type { AuthGuards } from './auth.guards';
import { validate } from '../../../../shared/presentation/validation/validate';
import { TotpCodeBody, PasswordBody, SmsActivationCodeBody, PreferredMethodBody } from './requests/iam.request';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';

/**
 * TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN
 */

/** POST /iam/mfa/setup-totp */

export function createMfaRouter(controller: MfaController, guards: AuthGuards): Router {
  const router = express.Router();

  router.post(
    '/iam/mfa/setup-totp',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    controller.setupTOTP
  );

  /** POST /iam/mfa/activate-totp */
  router.post(
    '/iam/mfa/activate-totp',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: TotpCodeBody }),
    controller.activateTOTP
  );

  /** POST /iam/mfa/verify-totp */
  router.post(
    '/iam/mfa/verify-totp',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: TotpCodeBody }),
    controller.verifyTOTP
  );

  /** POST /iam/mfa/validate-password */
  router.post(
    '/iam/mfa/validate-password',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: PasswordBody }),
    controller.validatePassword
  );

  /** POST /iam/mfa/deactivate-totp */
  router.post(
    '/iam/mfa/deactivate-totp',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: PasswordBody }),
    controller.deactivateTOTP
  );

  /** GET /iam/mfa/status */
  router.get(
    '/iam/mfa/status',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    controller.getStatus
  );

  /** POST /iam/mfa/sms/request */
  router.post(
    '/iam/mfa/sms/request',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: PasswordBody }),
    controller.requestSMSActivation
  );

  /** POST /iam/mfa/sms/confirm */
  router.post(
    '/iam/mfa/sms/confirm',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: SmsActivationCodeBody }),
    controller.confirmSMSActivation
  );

  /** POST /iam/mfa/deactivate-sms */
  router.post(
    '/iam/mfa/deactivate-sms',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: PasswordBody }),
    controller.deactivateSMS
  );

  /** PUT /iam/mfa/preferred-method */
  router.put(
    '/iam/mfa/preferred-method',
    guards.authenticate,
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers(),
    validate({ body: PreferredMethodBody }),
    controller.updatePreferredMethod
  );

  return router;
}
