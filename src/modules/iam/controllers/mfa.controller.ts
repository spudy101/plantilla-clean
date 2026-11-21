import MFAService from '../services/mfa.service';
import ApiResponse from '../../../shared/presentation/http/app-response.util';
import errorMiddlewareModule from '../../../shared/presentation/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import authUserUtilModule from '../../../shared/presentation/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;

class MFAController {
  /** POST /mfa/setup-totp */
  setupTOTP = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.setupTOTP(user.userId, user.username);
    return ApiResponse.success(res, 'TOTP configurado correctamente', result);
  });

  /** POST /mfa/activate-totp */
  activateTOTP = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.verifyAndActivateTOTP(
      req.body.totpCode,
      user.userId,
      user.username,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'TOTP activado correctamente', result);
  });

  /** POST /mfa/verify-totp */
  verifyTOTP = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.verifyTOTP(req.body.totpCode, user.userId, user.username);
    return ApiResponse.success(res, 'Código TOTP válido', result);
  });

  /** POST /mfa/deactivate-totp */
  deactivateTOTP = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.deactivateTOTP(
      req.body.password,
      user.userId,
      user.username,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'TOTP desactivado correctamente', result);
  });

  /** POST /mfa/validate-password */
  validatePassword = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.validatePassword(req.body.password, user.userId, user.username);
    const message = result.valid ? 'Contraseña correcta' : 'Contraseña inválida';
    return ApiResponse.success(res, message, result);
  });

  /** GET /mfa/status */
  getStatus = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.getStatus(user.userId, user.username);
    return ApiResponse.success(res, 'Estado MFA obtenido correctamente', result);
  });

  /** POST /mfa/sms/request */
  requestSMSActivation = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.requestSMSActivation(req.body.password, user.userId, user.username);
    return ApiResponse.success(res, 'Código de verificación enviado', result);
  });

  /** POST /mfa/sms/confirm */
  confirmSMSActivation = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.confirmSMSActivation(
      req.body.code,
      user.userId,
      user.username,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'SMS MFA activado correctamente', result);
  });

  /** POST /mfa/deactivate-sms */
  deactivateSMS = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.deactivateSMSMFA(
      req.body.password,
      user.userId,
      user.username,
      user.firstName,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'SMS MFA desactivado correctamente', result);
  });

  /** PUT /mfa/preferred-method */
  updatePreferredMethod = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await MFAService.updatePreferredMethod(
      req.body.preferredMethod,
      user.userId,
      user.username,
      res.locals.auditContext
    );
    return ApiResponse.success(res, 'Método MFA preferido actualizado correctamente', result);
  });
}

export default new MFAController();
