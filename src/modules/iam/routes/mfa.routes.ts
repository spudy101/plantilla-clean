import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { TotpCodeBody, PasswordBody, SmsActivationCodeBody, PreferredMethodBody } from '../requests/iam.request';
const router = express.Router();
import MFAController from '../controllers/mfa.controller';
import AuthMiddleware from '../middlewares/auth.middleware';
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';

/**
 * TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN
 */

/** POST /iam/mfa/setup-totp */
router.post(
  '/iam/mfa/setup-totp',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  MFAController.setupTOTP
);

/** POST /iam/mfa/activate-totp */
router.post(
  '/iam/mfa/activate-totp',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: TotpCodeBody }),
  MFAController.activateTOTP
);

/** POST /iam/mfa/verify-totp */
router.post(
  '/iam/mfa/verify-totp',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: TotpCodeBody }),
  MFAController.verifyTOTP
);

/** POST /iam/mfa/validate-password */
router.post(
  '/iam/mfa/validate-password',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: PasswordBody }),
  MFAController.validatePassword
);

/** POST /iam/mfa/deactivate-totp */
router.post(
  '/iam/mfa/deactivate-totp',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: PasswordBody }),
  MFAController.deactivateTOTP
);

/** GET /iam/mfa/status */
router.get(
  '/iam/mfa/status',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  MFAController.getStatus
);

/** POST /iam/mfa/sms/request */
router.post(
  '/iam/mfa/sms/request',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: PasswordBody }),
  MFAController.requestSMSActivation
);

/** POST /iam/mfa/sms/confirm */
router.post(
  '/iam/mfa/sms/confirm',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: SmsActivationCodeBody }),
  MFAController.confirmSMSActivation
);

/** POST /iam/mfa/deactivate-sms */
router.post(
  '/iam/mfa/deactivate-sms',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: PasswordBody }),
  MFAController.deactivateSMS
);

/** PUT /iam/mfa/preferred-method */
router.put(
  '/iam/mfa/preferred-method',
  AuthMiddleware.authenticate,
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: PreferredMethodBody }),
  MFAController.updatePreferredMethod
);

export default router;
