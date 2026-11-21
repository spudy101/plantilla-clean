import SendVerificationService from '../services/send-verification.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;

class SendVerificationController {
  /** POST /verification/send-verification */
  sendVerification = asyncHandler(async (req, res) => {
    const result = await SendVerificationService.sendVerificationCode(req.body);
    return ApiResponse.success(res, 'Código de verificación enviado', result);
  });

  /** POST /verification/verify-code */
  verifyCode = asyncHandler(async (req, res) => {
    const result = await SendVerificationService.verifyCode(req.body);
    return ApiResponse.success(res, 'Código verificado exitosamente', result);
  });
}

export default new SendVerificationController();
