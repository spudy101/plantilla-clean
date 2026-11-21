import express from 'express';
import { validate } from '../../../shared/validation/validate';
import { SendVerificationBody, VerifyCodeBody } from '../requests/notification.request';
const router = express.Router();
import SendVerificationController from '../controllers/send-verification.controller';
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';

// ============================================================
// PUBLIC
// ============================================================

/** POST /verification/send-verification */
router.post(
  '/send-verification',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ body: SendVerificationBody }),
  SendVerificationController.sendVerification
);

/** POST /verification/verify-code */
router.post(
  '/verify-code',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ body: VerifyCodeBody }),
  SendVerificationController.verifyCode
);

export default router;
