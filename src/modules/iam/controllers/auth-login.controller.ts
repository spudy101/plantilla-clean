import type { Request } from 'express';
import AuthLoginService from '../services/auth-login.service';
import ApiResponse from '../../../shared/http/app-response.util';
import AppError from '../../../shared/http/app-error.util';
import errorMiddlewareModule from '../../../shared/http/error.middleware';
const { asyncHandler } = errorMiddlewareModule;
import constantsModule from '../../../shared/constants';
const { AUTH_ERROR_CODES } = constantsModule;
import authUserUtilModule from '../../../shared/http/auth-user.util';
const { requireAuthUser } = authUserUtilModule;
import routeParamUtilModule from '../../../shared/http/route-param.util';
const { routeParam } = routeParamUtilModule;
import authCookiesUtilModule from '../utils/auth-cookies.util';
const { setAuthCookies, clearAuthCookies } = authCookiesUtilModule;

/**
 * ¿El request viene de un cliente web (cookies) o de mobile (headers)?
 *
 * El header `x-client-type` sigue mandando cuando está presente, pero no puede ser la única
 * señal: si el interceptor del front lo omite en /auth/refresh —cosa que pasa—, el back rotaba
 * el token y NO devolvía las cookies nuevas, dejando al navegador con un refresh ya revocado que
 * en la siguiente llamada se leía como reuse attack. La presencia de la cookie es la evidencia
 * directa de que hablamos con un navegador.
 */
const _isWebClient = (req: Request) => {
  if (req.headers['x-client-type'] === 'web') {
    return true;
  }
  return Boolean(req.cookies?.refresh_token || req.cookies?.access_token);
};

const _extractAccessToken = (req: Request, clientType: string) => {
  if (clientType === 'web') {
    return req.cookies?.access_token || null;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }
  const parts = authHeader.split(' ');
  return parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;
};

// ============================================================
// CONTROLLER
// ============================================================

class AuthLoginController {
  /**
   * POST /auth/login
   * Web:    setea cookies httpOnly + devuelve tokens en body
   * Mobile: devuelve tokens en body solamente
   */
  login = asyncHandler(async (req, res) => {
    const clientTypeHeader = req.headers['x-client-type'];
    const clientType = typeof clientTypeHeader === 'string' ? clientTypeHeader : null;

    const result = await AuthLoginService.login(req.body, {
      ip: res.locals.auditContext?.ip,
      userAgent: res.locals.auditContext?.userAgent,
      fingerprintHash: res.locals.fingerprintHash,
      clientType,
      serverContext: req.serverContext || null,
      pushToken: req.body.pushToken || null,
      pushDeviceId: req.body.pushDeviceId || null,
      pushPlatform: req.body.pushPlatform || null
    });

    // MFA / aprobación de dispositivo / política pendiente → respuesta sin tokens (no hay cookies que poner)
    if (_isWebClient(req) && 'tokens' in result && result.tokens) {
      setAuthCookies(res, result.tokens);
    }

    return ApiResponse.success(res, 'Inicio de sesión exitoso', result);
  });

  /** POST /auth/verify-mfa */
  verifyMFA = asyncHandler(async (req, res) => {
    const result = await AuthLoginService.verifyMFA(req.body, {
      ip: res.locals.auditContext?.ip,
      userAgent: res.locals.auditContext?.userAgent,
      fingerprintHash: res.locals.fingerprintHash,
      serverContext: req.serverContext || null,
      pushToken: req.body.pushToken || null,
      pushDeviceId: req.body.pushDeviceId || null,
      pushPlatform: req.body.pushPlatform || null
    });

    if (_isWebClient(req) && 'tokens' in result && result.tokens) {
      setAuthCookies(res, result.tokens);
    }

    return ApiResponse.success(res, 'Verificación MFA exitosa', result);
  });

  /**
   * POST /auth/refresh
   * No requiere access token válido (puede estar expirado).
   * Se autentica únicamente con el refresh token.
   * Web:    refresh token desde cookie
   * Mobile: refresh token desde header X-Refresh-Token
   */
  refreshToken = asyncHandler(async (req, res) => {
    // Se lee de donde esté, sin depender del header: la cookie manda en web y el header en mobile.
    // Antes, si el interceptor no mandaba x-client-type, el back leía el header inexistente y
    // respondía 401 con la cookie válida ahí adelante.
    const isWeb = _isWebClient(req);
    const refreshTkn = req.cookies?.refresh_token || req.headers['x-refresh-token'] || null;

    if (!refreshTkn) {
      throw AppError.unauthorized(isWeb ? 'Cookie refresh_token no encontrada' : 'Header X-Refresh-Token no proporcionado', {
        code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID
      });
    }

    const result = await AuthLoginService.refreshToken(refreshTkn);

    if (isWeb) {
      setAuthCookies(res, result);
    }

    return ApiResponse.success(res, 'Token renovado exitosamente', result);
  });

  /** POST /auth/logout */
  logout = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const isWeb = _isWebClient(req);

    const accessToken = _extractAccessToken(req, isWeb ? 'web' : 'mobile');
    const refreshToken = req.cookies?.refresh_token || req.headers['x-refresh-token'] || null;

    await AuthLoginService.logout(user.userId, res.locals.fingerprintHash, {
      accessToken,
      tokenExp: user.tokenExp,
      refreshToken,
      sessionId: user.sessionId || null
    });

    if (isWeb) {
      clearAuthCookies(res);
    }

    return ApiResponse.success(res, 'Sesión cerrada exitosamente');
  });

  /** POST /auth/logout-all */
  logoutAll = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const isWeb = _isWebClient(req);

    const accessToken = _extractAccessToken(req, isWeb ? 'web' : 'mobile');

    await AuthLoginService.logoutAll(user.userId, {
      accessToken,
      tokenExp: user.tokenExp,
      firstName: user.firstName
    });

    if (isWeb) {
      clearAuthCookies(res);
    }

    return ApiResponse.success(res, 'Sesión cerrada en todos los dispositivos');
  });

  // ============================================================
  // DISPOSITIVOS
  // ============================================================

  /** GET /auth/devices */
  getTrustedDevices = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await AuthLoginService.getTrustedDevices(
      user.userId,
      res.locals.fingerprintHash,
      user.sessionId || null
    );
    return ApiResponse.success(res, 'Dispositivos obtenidos exitosamente', result);
  });

  /** DELETE /auth/sessions/:sessionId */
  closeSession = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await AuthLoginService.closeSessionById(user.userId, routeParam(req, 'sessionId'), user.sessionId || null);
    return ApiResponse.success(res, 'Sesión cerrada exitosamente', result);
  });

  /** POST /auth/logout-others */
  logoutOthers = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await AuthLoginService.closeOtherSessions(user.userId, user.sessionId || null);
    return ApiResponse.success(res, 'Todas las demás sesiones han sido cerradas', result);
  });

  /** GET /auth/devices/pending */
  getPendingDevices = asyncHandler(async (req, res) => {
    const result = await AuthLoginService.getPendingDevices(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Dispositivos pendientes de aprobación', result);
  });

  /** PATCH /auth/devices/:deviceId */
  renameDevice = asyncHandler(async (req, res) => {
    const result = await AuthLoginService.renameDevice(requireAuthUser(req).userId, routeParam(req, 'deviceId'), req.body.deviceName);
    return ApiResponse.success(res, 'Dispositivo renombrado exitosamente', result);
  });

  /** POST /auth/devices/:deviceId/approve */
  approveDevice = asyncHandler(async (req, res) => {
    const result = await AuthLoginService.approveDevice(requireAuthUser(req).userId, routeParam(req, 'deviceId'), res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Dispositivo aprobado exitosamente', result);
  });

  /** POST /auth/devices/:deviceId/block */
  blockDevice = asyncHandler(async (req, res) => {
    const result = await AuthLoginService.blockDevice(requireAuthUser(req).userId, routeParam(req, 'deviceId'), res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Dispositivo bloqueado exitosamente', result);
  });

  /** POST /auth/devices/:deviceId/unblock */
  unblockDevice = asyncHandler(async (req, res) => {
    const result = await AuthLoginService.unblockDevice(requireAuthUser(req).userId, routeParam(req, 'deviceId'), res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Dispositivo desbloqueado exitosamente', result);
  });
}

export default new AuthLoginController();
