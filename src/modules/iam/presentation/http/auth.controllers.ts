// Controladores HTTP de la autenticación del propio usuario: login y sesión, dispositivos, registro y reset de
// credenciales, biometría y MFA. Sacan del request lo que piden los casos de uso (body, sesión de req.user, huella
// del dispositivo, cookies o headers según el canal) y no tienen reglas.
//
// Web usa cookies httpOnly (access + refresh); mobile, los tokens en el body y los headers Authorization /
// X-Refresh-Token.
import type { Request } from 'express';
import ApiResponse from '../../../../shared/presentation/http/app-response.util';
import AppError from '../../../../shared/presentation/http/app-error.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import authUserUtilModule from '../../../../shared/presentation/http/auth-user.util';
import routeParamUtilModule from '../../../../shared/presentation/http/route-param.util';
import AUTH_ERROR_CODES from '../../../../shared/domain/constants/auth-error-codes';
import type { Login, VerifyMfaLogin } from '../../application/use-cases/login.use-cases';
import type { CloseOtherSessions, CloseOwnSession, Logout, LogoutAll, RefreshTokens } from '../../application/use-cases/session-lifecycle.use-cases';
import type {
  ApproveDevice,
  BlockDevice,
  ListPendingDevices,
  ListTrustedDevices,
  RenameDevice,
  UnblockDevice
} from '../../application/use-cases/trusted-devices.use-cases';
import type { ConfirmCredentialReset, RegisterClient, RequestCredentialReset } from '../../application/use-cases/registration.use-cases';
import type {
  DeleteBiometricCredential,
  FinishBiometricLogin,
  FinishBiometricRegistration,
  ListBiometricCredentials,
  StartBiometricLogin,
  StartBiometricRegistration
} from '../../application/use-cases/biometric.use-cases';
import type {
  ActivateTotp,
  ConfirmSmsMfaActivation,
  DeactivateSmsMfa,
  DeactivateTotp,
  GetMfaStatus,
  MfaActor,
  RequestSmsMfaActivation,
  SetupTotp,
  UpdatePreferredMfaMethod,
  ValidateMfaPassword,
  VerifyTotp
} from '../../application/use-cases/mfa.use-cases';
import type { AuthCookies } from './auth-cookies';

const { asyncHandler } = errorMiddlewareModule;
const { requireAuthUser } = authUserUtilModule;
const { routeParam } = routeParamUtilModule;

/**
 * ¿El request viene de un cliente web (cookies) o de mobile (headers)? El header x-client-type manda cuando está, pero
 * no puede ser la única señal: si el interceptor del front lo omite en /auth/refresh, el back rotaba el token y NO
 * devolvía las cookies nuevas. La presencia de la cookie es la evidencia directa de que hablamos con un navegador.
 */
const isWebClient = (req: Request) => {
  if (req.headers['x-client-type'] === 'web') {
    return true;
  }
  return Boolean(req.cookies?.refresh_token || req.cookies?.access_token);
};

const extractAccessToken = (req: Request, clientType: string) => {
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

const refreshTokenOf = (req: Request) => req.cookies?.refresh_token || req.headers['x-refresh-token'] || null;

// ============================================================
// LOGIN, SESIÓN Y DISPOSITIVOS
// ============================================================

export interface AuthLoginUseCases {
  login: Login;
  verifyMfa: VerifyMfaLogin;
  refresh: RefreshTokens;
  logout: Logout;
  logoutAll: LogoutAll;
  closeSession: CloseOwnSession;
  closeOtherSessions: CloseOtherSessions;
  listDevices: ListTrustedDevices;
  listPendingDevices: ListPendingDevices;
  renameDevice: RenameDevice;
  approveDevice: ApproveDevice;
  blockDevice: BlockDevice;
  unblockDevice: UnblockDevice;
}

export class AuthLoginController {
  constructor(
    private readonly useCases: AuthLoginUseCases,
    private readonly cookies: AuthCookies
  ) {}

  /** POST /auth/login — web: cookies httpOnly + tokens en el body; mobile: solo el body. */
  login = asyncHandler(async (req, res) => {
    const clientTypeHeader = req.headers['x-client-type'];
    const clientType = typeof clientTypeHeader === 'string' ? clientTypeHeader : null;

    const result = await this.useCases.login.execute(req.body, {
      ip: res.locals.auditContext?.ip,
      userAgent: res.locals.auditContext?.userAgent,
      fingerprintHash: res.locals.fingerprintHash,
      clientType,
      serverContext: req.serverContext || null,
      pushToken: req.body.pushToken || null,
      pushDeviceId: req.body.pushDeviceId || null,
      pushPlatform: req.body.pushPlatform || null
    });

    // MFA / política pendiente → respuesta sin tokens (no hay cookies que poner)
    if (isWebClient(req) && 'tokens' in result && result.tokens) {
      this.cookies.set(res, result.tokens);
    }
    return ApiResponse.success(res, 'Inicio de sesión exitoso', result);
  });

  /** POST /auth/verify-mfa */
  verifyMFA = asyncHandler(async (req, res) => {
    const result = await this.useCases.verifyMfa.execute(req.body, {
      ip: res.locals.auditContext?.ip,
      userAgent: res.locals.auditContext?.userAgent,
      fingerprintHash: res.locals.fingerprintHash,
      serverContext: req.serverContext || null,
      pushToken: req.body.pushToken || null,
      pushDeviceId: req.body.pushDeviceId || null,
      pushPlatform: req.body.pushPlatform || null
    });
    if (isWebClient(req) && 'tokens' in result && result.tokens) {
      this.cookies.set(res, result.tokens);
    }
    return ApiResponse.success(res, 'Verificación MFA exitosa', result);
  });

  /**
   * POST /auth/refresh — se autentica solo con el refresh token (el access puede estar vencido). Se lee de donde
   * esté: la cookie manda en web y el header X-Refresh-Token en mobile.
   */
  refreshToken = asyncHandler(async (req, res) => {
    const isWeb = isWebClient(req);
    const refreshTkn = refreshTokenOf(req);
    if (!refreshTkn) {
      throw AppError.unauthorized(isWeb ? 'Cookie refresh_token no encontrada' : 'Header X-Refresh-Token no proporcionado', {
        code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID
      });
    }
    const result = await this.useCases.refresh.execute(refreshTkn);
    if (isWeb) {
      this.cookies.set(res, result);
    }
    return ApiResponse.success(res, 'Token renovado exitosamente', result);
  });

  /** POST /auth/logout */
  logout = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const isWeb = isWebClient(req);
    await this.useCases.logout.execute(user.userId, res.locals.fingerprintHash, {
      accessToken: extractAccessToken(req, isWeb ? 'web' : 'mobile'),
      tokenExp: user.tokenExp,
      refreshToken: refreshTokenOf(req),
      sessionId: user.sessionId || null
    });
    if (isWeb) {
      this.cookies.clear(res);
    }
    return ApiResponse.success(res, 'Sesión cerrada exitosamente');
  });

  /** POST /auth/logout-all */
  logoutAll = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const isWeb = isWebClient(req);
    await this.useCases.logoutAll.execute(user.userId, {
      accessToken: extractAccessToken(req, isWeb ? 'web' : 'mobile'),
      tokenExp: user.tokenExp,
      firstName: user.firstName
    });
    if (isWeb) {
      this.cookies.clear(res);
    }
    return ApiResponse.success(res, 'Sesión cerrada en todos los dispositivos');
  });

  /** GET /auth/devices */
  getTrustedDevices = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await this.useCases.listDevices.execute(user.userId, res.locals.fingerprintHash, user.sessionId || null);
    return ApiResponse.success(res, 'Dispositivos obtenidos exitosamente', result);
  });

  /** DELETE /auth/sessions/:sessionId */
  closeSession = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await this.useCases.closeSession.execute(user.userId, routeParam(req, 'sessionId'), user.sessionId || null);
    return ApiResponse.success(res, 'Sesión cerrada exitosamente', result);
  });

  /** POST /auth/logout-others */
  logoutOthers = asyncHandler(async (req, res) => {
    const user = requireAuthUser(req);
    const result = await this.useCases.closeOtherSessions.execute(user.userId, user.sessionId || null);
    return ApiResponse.success(res, 'Todas las demás sesiones han sido cerradas', result);
  });

  /** GET /auth/devices/pending */
  getPendingDevices = asyncHandler(async (req, res) => {
    const result = await this.useCases.listPendingDevices.execute(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Dispositivos pendientes de aprobación', result);
  });

  /** PATCH /auth/devices/:deviceId */
  renameDevice = asyncHandler(async (req, res) => {
    const result = await this.useCases.renameDevice.execute(requireAuthUser(req).userId, routeParam(req, 'deviceId'), req.body.deviceName);
    return ApiResponse.success(res, 'Dispositivo renombrado exitosamente', result);
  });

  /** POST /auth/devices/:deviceId/approve */
  approveDevice = asyncHandler(async (req, res) => {
    const result = await this.useCases.approveDevice.execute(requireAuthUser(req).userId, routeParam(req, 'deviceId'), res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Dispositivo aprobado exitosamente', result);
  });

  /** POST /auth/devices/:deviceId/block */
  blockDevice = asyncHandler(async (req, res) => {
    const result = await this.useCases.blockDevice.execute(requireAuthUser(req).userId, routeParam(req, 'deviceId'), res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Dispositivo bloqueado exitosamente', result);
  });

  /** POST /auth/devices/:deviceId/unblock */
  unblockDevice = asyncHandler(async (req, res) => {
    const result = await this.useCases.unblockDevice.execute(requireAuthUser(req).userId, routeParam(req, 'deviceId'), res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Dispositivo desbloqueado exitosamente', result);
  });
}

// ============================================================
// REGISTRO Y RESET DE CREDENCIALES
// ============================================================

export interface AuthRegisterUseCases {
  register: RegisterClient;
  requestReset: RequestCredentialReset;
  confirmReset: ConfirmCredentialReset;
}

export class AuthRegisterController {
  constructor(
    private readonly useCases: AuthRegisterUseCases,
    private readonly cookies: AuthCookies
  ) {}

  /** POST /auth/register — login automático al final; web: cookies httpOnly + tokens en el body (el front necesita expiresIn). */
  register = asyncHandler(async (req, res) => {
    const clientType = req.headers['x-client-type'];
    const result = await this.useCases.register.execute(req.body, { ip: res.locals.auditContext?.ip });
    if (clientType === 'web') {
      this.cookies.set(res, result.tokens);
    }
    return ApiResponse.created(res, 'Usuario registrado exitosamente', result);
  });

  /** POST /auth/reset-credentials/request (anti-enumeración: siempre el mismo mensaje) */
  requestResetCredentials = asyncHandler(async (req, res) => {
    await this.useCases.requestReset.execute(req.body);
    return ApiResponse.success(res, 'Si el email existe en nuestro sistema, recibirás un correo con instrucciones');
  });

  /** POST /auth/reset-credentials/confirm */
  confirmResetCredentials = asyncHandler(async (req, res) => {
    await this.useCases.confirmReset.execute(req.body);
    const message = req.body.type === 'password' ? 'Contraseña actualizada exitosamente' : 'MFA desactivado exitosamente';
    return ApiResponse.success(res, message);
  });
}

// ============================================================
// BIOMETRÍA
// ============================================================

export interface AuthBiometricUseCases {
  registerStart: StartBiometricRegistration;
  registerFinish: FinishBiometricRegistration;
  loginStart: StartBiometricLogin;
  loginFinish: FinishBiometricLogin;
  listCredentials: ListBiometricCredentials;
  deleteCredential: DeleteBiometricCredential;
}

export class AuthBiometricController {
  constructor(private readonly useCases: AuthBiometricUseCases) {}

  /** POST /auth/biometric/register/start */
  registerStart = asyncHandler(async (req, res) => {
    const result = await this.useCases.registerStart.execute(requireAuthUser(req).userId, res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Challenge de registro generado', result);
  });

  /** POST /auth/biometric/register/finish */
  registerFinish = asyncHandler(async (req, res) => {
    const result = await this.useCases.registerFinish.execute(req.body, requireAuthUser(req).userId, res.locals.fingerprintHash);
    return ApiResponse.success(res, 'Huella registrada exitosamente', result, 201);
  });

  /** POST /auth/biometric/login/start */
  loginStart = asyncHandler(async (req, res) => {
    const result = await this.useCases.loginStart.execute(req.body);
    return ApiResponse.success(res, 'Challenge de autenticación generado', result);
  });

  /** POST /auth/biometric/login/finish — con la política pendiente responde sin tokens (el cliente lo ve en el payload). */
  loginFinish = asyncHandler(async (req, res) => {
    const result = await this.useCases.loginFinish.execute(req.body, {
      ip: res.locals.auditContext?.ip,
      userAgent: res.locals.auditContext?.userAgent,
      fingerprintHash: res.locals.fingerprintHash,
      acceptPolicy: req.body.acceptPolicy === true
    });
    return ApiResponse.success(res, 'Autenticación biométrica exitosa', result);
  });

  /** GET /auth/biometric/credentials */
  getCredentials = asyncHandler(async (req, res) => {
    const result = await this.useCases.listCredentials.execute(requireAuthUser(req).userId);
    return ApiResponse.success(res, 'Credenciales biométricas', result);
  });

  /** DELETE /auth/biometric/:credentialId */
  deleteCredential = asyncHandler(async (req, res) => {
    await this.useCases.deleteCredential.execute(requireAuthUser(req).userId, routeParam(req, 'credentialId'));
    return ApiResponse.noContent(res);
  });
}

// ============================================================
// MFA
// ============================================================

export interface MfaUseCases {
  setupTotp: SetupTotp;
  activateTotp: ActivateTotp;
  verifyTotp: VerifyTotp;
  deactivateTotp: DeactivateTotp;
  validatePassword: ValidateMfaPassword;
  getStatus: GetMfaStatus;
  requestSmsActivation: RequestSmsMfaActivation;
  confirmSmsActivation: ConfirmSmsMfaActivation;
  deactivateSms: DeactivateSmsMfa;
  updatePreferredMethod: UpdatePreferredMfaMethod;
}

const actorOf = (req: Request): MfaActor => {
  const user = requireAuthUser(req);
  return { userId: user.userId, username: user.username, firstName: user.firstName };
};

export class MfaController {
  constructor(private readonly useCases: MfaUseCases) {}

  /** POST /mfa/setup-totp */
  setupTOTP = asyncHandler(async (req, res) => {
    const result = await this.useCases.setupTotp.execute(actorOf(req));
    return ApiResponse.success(res, 'TOTP configurado correctamente', result);
  });

  /** POST /mfa/activate-totp */
  activateTOTP = asyncHandler(async (req, res) => {
    const result = await this.useCases.activateTotp.execute(actorOf(req), req.body.totpCode);
    return ApiResponse.success(res, 'TOTP activado correctamente', result);
  });

  /** POST /mfa/verify-totp */
  verifyTOTP = asyncHandler(async (req, res) => {
    const result = await this.useCases.verifyTotp.execute(actorOf(req), req.body.totpCode);
    return ApiResponse.success(res, 'Código TOTP válido', result);
  });

  /** POST /mfa/deactivate-totp */
  deactivateTOTP = asyncHandler(async (req, res) => {
    const result = await this.useCases.deactivateTotp.execute(actorOf(req), req.body.password);
    return ApiResponse.success(res, 'TOTP desactivado correctamente', result);
  });

  /** POST /mfa/validate-password */
  validatePassword = asyncHandler(async (req, res) => {
    const result = await this.useCases.validatePassword.execute(actorOf(req), req.body.password);
    return ApiResponse.success(res, result.valid ? 'Contraseña correcta' : 'Contraseña inválida', result);
  });

  /** GET /mfa/status */
  getStatus = asyncHandler(async (req, res) => {
    const result = await this.useCases.getStatus.execute(actorOf(req));
    return ApiResponse.success(res, 'Estado MFA obtenido correctamente', result);
  });

  /** POST /mfa/sms/request */
  requestSMSActivation = asyncHandler(async (req, res) => {
    const result = await this.useCases.requestSmsActivation.execute(actorOf(req), req.body.password);
    return ApiResponse.success(res, 'Código de verificación enviado', result);
  });

  /** POST /mfa/sms/confirm */
  confirmSMSActivation = asyncHandler(async (req, res) => {
    const result = await this.useCases.confirmSmsActivation.execute(actorOf(req), req.body.code);
    return ApiResponse.success(res, 'SMS MFA activado correctamente', result);
  });

  /** POST /mfa/deactivate-sms */
  deactivateSMS = asyncHandler(async (req, res) => {
    const result = await this.useCases.deactivateSms.execute(actorOf(req), req.body.password);
    return ApiResponse.success(res, 'SMS MFA desactivado correctamente', result);
  });

  /** PUT /mfa/preferred-method */
  updatePreferredMethod = asyncHandler(async (req, res) => {
    const result = await this.useCases.updatePreferredMethod.execute(actorOf(req), req.body.preferredMethod);
    return ApiResponse.success(res, 'Método MFA preferido actualizado correctamente', result);
  });
}
