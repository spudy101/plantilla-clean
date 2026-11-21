// ============================================================
// auth-biometric.controller.ts
// ============================================================

import AuthBiometricService from '../services/auth-biometric.service';
import ApiResponse from '../../../shared/http/app-response.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;

class AuthBiometricController {
  /** POST /auth/biometric/register/start */
  registerStart = asyncHandler(async (req, res) => {
    const result = await AuthBiometricService.registerStart(requireAuthUser(req).userId, res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Challenge de registro generado', result);
  });

  /** POST /auth/biometric/register/finish */
  registerFinish = asyncHandler(async (req, res) => {
    const result = await AuthBiometricService.registerFinish(req.body, requireAuthUser(req).userId, res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Huella registrada exitosamente', result, 201);
  });

  /** POST /auth/biometric/login/start */
  loginStart = asyncHandler(async (req, res) => {
    const result = await AuthBiometricService.loginStart(req.body);
    return ApiResponse.success(res, 'Challenge de autenticación generado', result);
  });

  /** POST /auth/biometric/login/finish */
  loginFinish = asyncHandler(async (req, res) => {
    const result = await AuthBiometricService.loginFinish(req.body, {
      ip: res.locals.auditContext?.ip,
      userAgent: res.locals.auditContext?.userAgent,
      fingerprintHash: res.locals.fingerprintHash,
      acceptPolicy: req.body.acceptPolicy === true
    });

    // result.requiresPolicyAcceptance=true ⇒ el service ya omitió los tokens; el cliente lo detecta
    // en el payload y muestra la aceptación de política. La respuesta HTTP es la misma en ambos casos.
    return ApiResponse.success(res, 'Autenticación biométrica exitosa', result);
  });

  /** GET /auth/biometric/credentials */
  getCredentials = asyncHandler(async (req, res) => {
    const result = await AuthBiometricService.getCredentials(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Credenciales biométricas', result);
  });

  /** DELETE /auth/biometric/:credentialId */
  deleteCredential = asyncHandler(async (req, res) => {
    await AuthBiometricService.deleteCredential(requireAuthUser(req).userId, routeParam(req, 'credentialId'));
    return ApiResponse.noContent(res);
  });
}

export default new AuthBiometricController();
