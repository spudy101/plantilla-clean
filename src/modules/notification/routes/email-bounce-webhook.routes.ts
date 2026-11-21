// Ruta inbound del webhook de bounces de SES (vía SNS).
//
// La llama AWS SNS (no un usuario) → sin AuthMiddleware.authenticate ni RBAC. Se autentica por apikey
// en query (externalWebhookAuthenticate) y, sobre todo, por la FIRMA del mensaje SNS (verificada en el
// service). SNS envía Content-Type text/plain → el express.json global NO lo parsea, por eso se captura
// el body como texto crudo con express.text en la propia ruta.

import express from 'express';

const router = express.Router();
import EmailBounceWebhookController from '../controllers/email-bounce-webhook.controller';
import iamModule from '../../iam';
const { AuthMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import { markOperationSource } from '../../../shared/infrastructure/observability/operation';

const WEBHOOK_BODY_LIMIT = '256kb';

// POST /notification/email-bounces/webhook — feed asíncrono de bounces de SES.
router.post(
  '/email-bounces/webhook',
  markOperationSource('webhook'),
  express.text({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }),
  AuthMiddleware.externalWebhookAuthenticate,
  RateLimitMiddleware.apiLimiter(),
  EmailBounceWebhookController.process
);

export default router;
