// Controller del webhook inbound de bounces de SES (vía SNS). Lo llama SNS (no un usuario).
// Responde 200 con un ack. Sin lógica de negocio.

import EmailBounceWebhookService from '../services/email-bounce-webhook.service';
import emailBounceWebhookDtoModule from '../responses/email-bounce-webhook.response';
const { EmailBounceWebhookAckDTO } = emailBounceWebhookDtoModule;
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;

class EmailBounceWebhookController {
  /** POST /notification/email-bounces/webhook */
  process = asyncHandler(async (req, res) => {
    const result = await EmailBounceWebhookService.process(req.body);
    return ApiResponse.success(res, 'Webhook de bounces recibido', new EmailBounceWebhookAckDTO(result));
  });
}

export default new EmailBounceWebhookController();
