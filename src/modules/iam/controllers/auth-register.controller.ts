import AuthRegisterService from '../services/auth-register.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;

import authCookiesUtilModule from '../utils/auth-cookies.util';
const { setAuthCookies } = authCookiesUtilModule;

// ============================================================
// CONTROLLER
// ============================================================

class AuthRegisterController {
  /**
   * POST /auth/register
   *
   * El registro hace login automático al final.
   * Web:    setea cookies httpOnly + devuelve tokens en body (el front necesita expiresIn)
   * Mobile: devuelve tokens en body solamente
   */
  register = asyncHandler(async (req, res) => {
    const clientType = req.headers['x-client-type'];

    const result = await AuthRegisterService.register(req.body, {
      ip: res.locals.auditContext?.ip
    });

    if (clientType === 'web') {
      setAuthCookies(res, result.tokens);
    }

    return ApiResponse.created(res, 'Usuario registrado exitosamente', result);
  });

  /**
   * POST /auth/reset-credentials/request
   * Sin cambios — no devuelve tokens
   */
  requestResetCredentials = asyncHandler(async (req, res) => {
    await AuthRegisterService.requestResetCredentials(req.body);
    return ApiResponse.success(res, 'Si el email existe en nuestro sistema, recibirás un correo con instrucciones');
  });

  /**
   * POST /auth/reset-credentials/confirm
   * Sin cambios — no devuelve tokens
   */
  confirmResetCredentials = asyncHandler(async (req, res) => {
    await AuthRegisterService.confirmResetCredentials(req.body);
    const message = req.body.type === 'password' ? 'Contraseña actualizada exitosamente' : 'MFA desactivado exitosamente';
    return ApiResponse.success(res, message);
  });
}

export default new AuthRegisterController();
