// src/middlewares/auth.middleware.ts
// ACTUALIZADO: validación de timestamp mobile cambiada de AES a HMAC-SHA256
//
// Cambio en _validateTimestamp():
//   ANTES: mobile enviaba x-timestamp cifrado con AES (requería llave AES en mobile)
//   AHORA: mobile envía:
//     - x-timestamp: unix ms en texto plano
//     - x-signature: HMAC-SHA256(`${timestamp}:${method}:${path}`, HMAC_SECRET)
//
// Ventajas del cambio:
//   - El mobile solo necesita el HMAC_SECRET (para firmar, no para descifrar)
//   - Incluso si el HMAC_SECRET se filtra, no permite descifrar ningún dato
//   - La firma cubre timestamp + método + path → protección contra replay más fuerte
//   - Comparación en tiempo constante (timingSafeEqual) → sin timing attacks

import { interopDefault } from '../../../shared/kernel/interop.util';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../../../shared/presentation/types/express';
import crypto from 'node:crypto';
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../../../shared/infrastructure/config';
const {
  server,
  encryption,
  SECURITY,
  AUTH_ERROR_CODES,
  INTERNAL_ROLE_NAMES,
  MFA_REQUIRED_ROLES,
  MFA_NOT_ACTIVE_LOG_MSG
} = constantsModule;
import HmacService from '../services/hmac.service';
import DeviceBlocklistUtil from '../utils/device-blocklist.util';
import TokenBlacklistUtil from '../utils/token-blacklist.util';
import JwtUtil from '../../../shared/infrastructure/security/jwt.util';
import redisClient from '../../../shared/infrastructure/cache/redis.util';
import requestContext from '../../../shared/infrastructure/observability/request-context.util';
import domainEnumsModule from '../../../shared/infrastructure/database/domain-enums';
const { USER_SESSION_STATUS } = domainEnumsModule;

// Lazy require: el repositorio vive en modules/ y cargarlo al arrancar crearía un ciclo
// (igual que auth-trusted-device.repository más abajo). SOLID: D — el middleware no consulta modelos.
const sessionRepository = () => interopDefault(require('../repositories/user-session.repository') as typeof import('../repositories/user-session.repository'));
import mfaStatusUtilModule from '../utils/mfa-status.util';
const { isMfaActive } = mfaStatusUtilModule;
import errorMessageModule from '../../../shared/kernel/error-message.util';

const { errorMessage } = errorMessageModule;


const MS_PER_MINUTE = 60 * 1000;

const API_KEY_LOG_LENGTH = 24;


class AuthMiddleware {
  static authenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await AuthMiddleware._performAuthentication(req, false);
      next();
    } catch (error) {
      next(error instanceof AppError ? error : AppError.unauthorized('Error al autenticar usuario'));
    }
  };

  static requireRole(allowedRoles: readonly string[] = []) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = await AuthMiddleware._performAuthentication(req, true);

        if (!user.roleName || !allowedRoles.includes(user.roleName)) {
          logger.warn('Access denied — insufficient role', {
            userId: user.userId,
            userRole: user.roleName,
            allowedRoles,
            path: req.path
          });
          throw AppError.forbidden('No tienes permisos para acceder a este recurso');
        }

        // RF-ADM-01 #6 — admins/internos deben tener 2FA activo para operar.
        await AuthMiddleware._enforceMfaForPrivilegedRoles(req);

        next();
      } catch (error) {
        next(error instanceof AppError ? error : AppError.unauthorized('Error al autenticar usuario'));
      }
    };
  }

  /**
   * Autenticación OPCIONAL — para endpoints PÚBLICOS que, si además hay sesión, atienden mejor al
   * titular (hoy: el widget del asistente, que vive en la landing y dentro del portal).
   *
   * **Nunca falla.** Sin credenciales sigue como anónimo; con credenciales inválidas o vencidas
   * también. El endpoint es público: la sesión solo agrega comodidades (saltar el captcha, prellenar
   * el contacto), así que romperlo con un 401 sería peor que atender a la persona sin identificarla
   * — y romperlo es lo que pasa en la práctica, porque el navegador conserva cookies `access_token`
   * de sesiones viejas y los clientes HTTP adjuntan el header `Authorization` por interceptor global.
   *
   * Por eso `req.user` se limpia si la autenticación falló a mitad de camino: quien lea `req.user`
   * río abajo debe ver "hay sesión válida" o "no hay sesión", nunca un estado a medias.
   * NO usar en endpoints que requieren identidad — para eso están `authenticate`/`requireRole`.
   */
  static optionalAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.cookies?.access_token && !req.headers.authorization) {
      return next();
    }
    try {
      await AuthMiddleware._performAuthentication(req, false);
    } catch (error) {
      delete req.user;
      AuthMiddleware._injectSessionIntoAuditContext(null);
      logger.debug('optionalAuthenticate: credenciales inválidas — se continúa como anónimo', { error: errorMessage(error) });
    }
    return next();
  };

  static externalAuthenticate = (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = req.header('X-API-Key');
      const validApiKey = AuthMiddleware._validateApiKey(apiKey);
      if (!validApiKey) {
        logger.warn('AuthMiddleware: API Key externa inválida', { service: 'external' });
        return next(AppError.unauthorized('API Key inválida'));
      }
      req.externalService = apiKey.slice(0, API_KEY_LOG_LENGTH);
      return next();
    } catch (error) {
      logger.error('AuthMiddleware: error en autenticación externa', { error: errorMessage(error) });
      return next(AppError.internal('Error en autenticación externa'));
    }
  };

  static externalWebhookAuthenticate = (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawKey = req.query.apiKey || req.query.api_key || req.query.key;
      // La query puede traer el parámetro repetido o como objeto: solo se acepta un string
      const apiKey = typeof rawKey === 'string' ? rawKey : undefined;
      const validApiKey = AuthMiddleware._validateApiKey(apiKey);
      if (!validApiKey) {
        logger.warn('AuthMiddleware: API Key de webhook inválida', { service: 'webhook' });
        return next(AppError.unauthorized('API Key inválida'));
      }
      req.externalService = 'webhook';
      return next();
    } catch (error) {
      logger.error('AuthMiddleware: error en autenticación de webhook', { error: errorMessage(error) });
      return next(AppError.internal('Error en autenticación de webhook'));
    }
  };

  // ============================================================
  // PRIVATE
  // ============================================================

  /**
   * Inyecta el sessionId en el auditContext del AsyncLocalStorage para que logAudit()
   * lo persista en audit_logs sin tocar los call sites. auditMiddleware corrió antes
   * (cuando aún no había req.user), pero dentro del mismo requestContext.run() — la
   * referencia del store es viva, así que la mutación se propaga al resto de la cadena.
   *
   * @private
   */
  static _injectSessionIntoAuditContext(sessionId: string | null, userId: string | null = null): void {
    const auditCtx = requestContext.get();
    if (auditCtx) {
      auditCtx.sessionId = sessionId ?? null;
      auditCtx.userId = userId ?? null;
    }
  }

  /** Autentica y deja el usuario en `req.user`; lo devuelve para que el llamador no dependa de `req.user!`. */
  static _performAuthentication(req: Request, requireRole = false): Promise<AuthenticatedUser> {
    return AuthMiddleware._performJwtAuthentication(req, requireRole);
  }

  static async _performJwtAuthentication(req: Request, requireRole = false): Promise<AuthenticatedUser> {
    const cookieAccessToken = req.cookies?.access_token;

    let accessToken: string;
    let canal: 'web' | 'mobile';

    if (cookieAccessToken) {
      canal = 'web';
      accessToken = cookieAccessToken;
    } else {
      canal = 'mobile';
      accessToken = AuthMiddleware._extractBearerToken(req);
    }

    // Validar firma HMAC del request (solo mobile en producción)
    if (server.nodeEnv === 'production' && canal === 'mobile') {
      await HmacService.verifyRequestSignature(req);
    }

    // Verificar y decodificar el JWT RS256 propio (una sola llamada)
    const decoded = await JwtUtil.verifyAccessToken(accessToken);

    if (!decoded.userId) {
      logger.warn('JWT RS256 missing userId claim', { canal });
      throw AppError.unauthorized('Token inválido');
    }

    if (requireRole && (!decoded.roleId || !decoded.roleName)) {
      logger.warn('JWT RS256 missing role claims', { userId: decoded.userId, canal });
      throw AppError.forbidden('Token sin rol asignado');
    }

    // ── Verificación de dispositivo bloqueado ────────────────────────────────
    await AuthMiddleware._checkDeviceBlocklist(req, decoded.userId);

    // ── Verificación de blacklist de tokens ──────────────────────────────────
    await AuthMiddleware._checkTokenBlacklist(accessToken, decoded.userId, decoded.iat, decoded.sessionId);

    const user: AuthenticatedUser = {
      sessionId: decoded.sessionId || null,
      userId: decoded.userId,
      personId: decoded.personId || null,
      roleId: decoded.roleId || null,
      roleName: decoded.roleName || null,
      firstName: decoded.firstName || null,
      lastName: decoded.lastName || null,
      nationalId: decoded.nationalId || null,
      username: decoded.authUsername || null,
      authUsername: decoded.authUsername || null,
      email: decoded.email || null,
      tokenIat: decoded.iat,
      tokenExp: decoded.exp,
      canal
    };
    req.user = user;

    AuthMiddleware._injectSessionIntoAuditContext(user.sessionId, user.userId);

    // ── RF-AUTH-02 CA-01/CA-04 — inactividad + last_access_at (cliente + interno) ──
    await AuthMiddleware._enforceInactivity(req);

    logger.debug('User authenticated from JWT RS256', { userId: user.userId, canal });
    return user;
  }

  /**
   * RF-AUTH-02 CA-01/CA-04 — control de inactividad unificado para TODOS los usuarios
   * autenticados (cliente e interno). Si `last_access_at` superó
   * SECURITY.SESSION_INACTIVITY_MINUTES (15 min), cierra la sesión en el acto y devuelve
   * 401: el usuario debe re-autenticarse (los internos con 2FA, flujo RF-AUTH-02/03).
   *
   * Si la sesión sigue activa, actualiza `last_access_at` (ventana deslizante) con throttle
   * de SECURITY.SESSION_ACCESS_THROTTLE_SECONDS para no escribir en BD en cada request. Así
   * `last_access_at` refleja la última vez que el usuario pegó a CUALQUIER API — la señal que
   * consume el worker de expiración y la vista "Mis dispositivos" (RF-AUTH-03).
   *
   * @private
   */
  // [RF-AUTH-02] | CA-01, CA-04 | Inactividad 15 min + last_access_at por request (cliente + interno)
  static async _enforceInactivity(req: Request) {
    const { sessionId, userId, roleName } = req.user || {};
    if (!sessionId) {
      logger.warn('Sesión sin sessionId — no se aplica control de inactividad', { userId });
      return;
    }

    const session = await sessionRepository().findActiveById(sessionId);

    if (!session) {
      throw AppError.unauthorized('Sesión no activa. Inicia sesión nuevamente.', {
        code: AUTH_ERROR_CODES.SESSION_CLOSED
      });
    }

    const idleMs = Date.now() - new Date(session.lastAccessAt).getTime();
    const maxIdleMs = SECURITY.SESSION_INACTIVITY_MINUTES * MS_PER_MINUTE;

    if (idleMs > maxIdleMs) {
      await sessionRepository().closeSession(sessionId, 'inactivity_timeout');
      logger.info('Sesión expirada por inactividad', { userId, sessionId });
      const isInternal = roleName && INTERNAL_ROLE_NAMES.includes(roleName);
      throw AppError.unauthorized(
        isInternal
          ? 'Sesión expirada por inactividad. Vuelve a iniciar sesión con 2FA.'
          : 'Sesión expirada por inactividad. Vuelve a iniciar sesión.',
        { code: AUTH_ERROR_CODES.SESSION_INACTIVITY }
      );
    }

    // Ventana deslizante con throttle: cada request renueva el contador, pero solo escribimos
    // en BD si pasó el umbral de throttle, para no golpear la BD en ráfagas de requests.
    if (idleMs > SECURITY.SESSION_ACCESS_THROTTLE_SECONDS * 1000) {
      await sessionRepository().touchLastAccess(sessionId);
    }
  }

  /**
   * RF-ADM-01 #6 — El 2FA es obligatorio para administradores y usuarios
   * internos. Si el rol está en MFA_REQUIRED_ROLES y el usuario no tiene MFA
   * activo (ni TOTP ni SMS), se bloquea la acción con 403 y código MFA_REQUIRED.
   *
   * El usuario SÍ puede loguearse y acceder a las rutas que no pasan por
   * requireRole/RbacMiddleware (activar MFA en /api/kyc/mfa/*, perfil, logout).
   *
   * @private
   */
  static async _enforceMfaForPrivilegedRoles(req: Request) {
    const roleName = req.user?.roleName;
    if (!roleName || !MFA_REQUIRED_ROLES.includes(roleName)) {
      return;
    }

    const userId = req.user?.userId;
    const active = await isMfaActive(userId);
    if (!active) {
      logger.info(MFA_NOT_ACTIVE_LOG_MSG, {
        userId,
        roleName,
        path: req.path
      });
      throw AppError.forbidden('Debes activar la autenticación de dos factores (2FA) para realizar esta acción', {
        code: 'MFA_REQUIRED'
      });
    }
  }

  static _extractBearerToken(req: Request): string {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw AppError.unauthorized('Token no proporcionado');
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw AppError.unauthorized('Formato de Authorization inválido. Use: Bearer <token>');
    }
    return parts[1] as string;
  }

  static _validateApiKey(apiKey: string | undefined): apiKey is string {
    if (!apiKey) {
      return false;
    }
    const validApiKeys = encryption.externalApiKeys ? encryption.externalApiKeys.split(',').map(k => k.trim()) : [];
    // Comparación en tiempo constante para evitar timing attacks.
    // Se hashea cada lado a longitud fija (sha256) y se recorren TODAS las claves
    // sin early-return, de modo que el tiempo no depende de cuántas coinciden.
    const received = crypto.createHash('sha256').update(apiKey).digest();
    let matched = false;
    for (const validKey of validApiKeys) {
      const expected = crypto.createHash('sha256').update(validKey).digest();
      if (crypto.timingSafeEqual(received, expected)) {
        matched = true;
      }
    }
    return matched;
  }

  /**
   * Verifica en Redis si el access token fue invalidado explícitamente.
   * Cubre tres escenarios:
   *   1. Blacklist individual: el token fue añadido al hacer logout de esta sesión.
   *   2. Umbral por sesión: la sesión se cerró (otro dispositivo, límite, re-login)
   *      o rotó en un refresh — se rechaza si el iat del token < umbral de la sesión.
   *   3. Invalidación global: el usuario hizo logout-all y tokenIat <= timestamp guardado.
   *
   * Fail-open: si Redis no está disponible, el request pasa.
   *
   * @private
   */
  // [RF-AUTH-02] | CA-02 | Verifica blacklist en cada request autenticado. Fallback a BD si Redis cae
  static async _checkTokenBlacklist(
    accessToken: string,
    userId: string,
    tokenIat: number | undefined,
    sessionId: string | null | undefined
  ): Promise<void> {
    // Política A — fallback a BD cuando Redis no está disponible (no fail-open).
    // La blacklist de tokens vive solo en Redis, pero TODA revocación de sesión
    // (logout, logout-all, cierre por límite/reauth) marca UserSession.status='closed'
    // en BD. Validamos contra esa fuente de verdad para no dejar pasar un token
    // de una sesión ya cerrada durante una caída de Redis.
    // Nota: este fallback no cubre la invalidación por rotación de refresh (umbral
    // por iat de una sesión que sigue activa); ese caso menor reaparece solo durante
    // el incidente de Redis.
    if (!redisClient.isAvailable()) {
      await AuthMiddleware._assertSessionActiveDbFallback(sessionId, userId);
      return;
    }

    const blacklisted = await TokenBlacklistUtil.isAccessTokenBlacklisted(accessToken);
    if (blacklisted) {
      logger.info('AuthMiddleware: acceso denegado — access token en blacklist', {
        userId
      });
      throw AppError.unauthorized('La sesión ha sido cerrada. Por favor inicia sesión nuevamente.', {
        code: AUTH_ERROR_CODES.SESSION_CLOSED
      });
    }

    const sessionTokenInvalidated = await TokenBlacklistUtil.isSessionTokenInvalidated(sessionId, tokenIat);
    if (sessionTokenInvalidated) {
      logger.info('AuthMiddleware: acceso denegado — token anterior al umbral de su sesión', {
        userId,
        sessionId
      });
      throw AppError.unauthorized('La sesión ha sido cerrada. Por favor inicia sesión nuevamente.', {
        code: AUTH_ERROR_CODES.SESSION_CLOSED
      });
    }

    const sessionInvalidated = await TokenBlacklistUtil.isUserSessionsInvalidated(userId, tokenIat);
    if (sessionInvalidated) {
      logger.info('AuthMiddleware: acceso denegado — sesión invalidada por logout-all', {
        userId,
        tokenIat
      });
      throw AppError.unauthorized('La sesión ha sido cerrada. Por favor inicia sesión nuevamente.', {
        code: AUTH_ERROR_CODES.SESSION_CLOSED
      });
    }
  }

  /**
   * Fallback a BD para la revocación de sesión cuando Redis no está disponible
   * (política A). Valida contra UserSession.status, que toda ruta de logout/cierre
   * persiste de forma confiable. Si la sesión no existe o está cerrada → 401.
   *
   * @private
   */
  static async _assertSessionActiveDbFallback(sessionId: string | null | undefined, userId: string): Promise<void> {
    if (!sessionId) {
      // Sin sessionId no hay forma de validar contra BD; el token sigue acotado
      // por su expiración natural. Se loguea para visibilidad de operaciones.
      logger.warn('AuthMiddleware: token sin sessionId — sesión no validada en BD (Redis caído)', { userId });
      return;
    }

    const session = await sessionRepository().findById(sessionId);

    if (!session || session.status !== USER_SESSION_STATUS.ACTIVE) {
      logger.warn('AuthMiddleware: acceso denegado — sesión cerrada (fallback BD, Redis caído)', {
        userId,
        sessionId
      });
      throw AppError.unauthorized('La sesión ha sido cerrada. Por favor inicia sesión nuevamente.', {
        code: AUTH_ERROR_CODES.SESSION_CLOSED
      });
    }
  }

  /**
   * Verifica en Redis si el dispositivo está en la blocklist.
   *
   * El fingerprintHash lo genera auditMiddleware a partir del User-Agent
   * y lo deja en res.locals.fingerprintHash antes de que llegue aquí.
   *
   * Fail-open: si Redis no está disponible (DeviceBlocklistUtil.isBlocked
   * retorna false), el request pasa — priorizamos disponibilidad.
   *
   * @private
   */
  static async _checkDeviceBlocklist(req: Request, userId: string) {
    const fingerprintHash = req.res?.locals?.fingerprintHash;

    if (!fingerprintHash) {
      // Sin fingerprint no podemos verificar — dejamos pasar y logueamos
      logger.warn('AuthMiddleware: fingerprintHash no disponible en res.locals, omitiendo check de blocklist', {
        userId,
        path: req.originalUrl
      });
      return;
    }

    // Política A — fallback a BD cuando Redis no está disponible (no fail-open).
    // El estado real del dispositivo vive en user_trusted_devices.status; Redis es
    // solo una caché para invalidación inmediata.
    if (!redisClient.isAvailable()) {
      await AuthMiddleware._assertDeviceNotBlockedDbFallback(userId, fingerprintHash, req);
      return;
    }

    const blocked = await DeviceBlocklistUtil.isBlocked(userId, fingerprintHash);

    if (blocked) {
      logger.warn('AuthMiddleware: acceso denegado — dispositivo bloqueado en Redis', {
        userId,
        fingerprintHash,
        path: req.originalUrl
      });
      throw AppError.forbidden('Este dispositivo ha sido bloqueado. Desbloquéalo desde otro dispositivo de confianza.', {
        code: AUTH_ERROR_CODES.DEVICE_BLOCKED
      });
    }
  }

  /**
   * Fallback a BD para la blocklist de dispositivos cuando Redis no está disponible
   * (política A). Consulta user_trusted_devices.status === 'blocked'.
   *
   * @private
   */
  static async _assertDeviceNotBlockedDbFallback(userId: string, fingerprintHash: string, req: Request) {
    // Lazy require para evitar dependencia circular al arrancar (igual que HmacService).
    const trustedDeviceRepo = interopDefault(require('../repositories/auth-trusted-device.repository') as typeof import('../repositories/auth-trusted-device.repository'));
    const device = await trustedDeviceRepo.findByFingerprint(userId, fingerprintHash);

    if (device && device.status === 'blocked') {
      logger.warn('AuthMiddleware: acceso denegado — dispositivo bloqueado (fallback BD, Redis caído)', {
        userId,
        fingerprintHash,
        path: req.originalUrl
      });
      throw AppError.forbidden('Este dispositivo ha sido bloqueado. Desbloquéalo desde otro dispositivo de confianza.', {
        code: AUTH_ERROR_CODES.DEVICE_BLOCKED
      });
    }
  }
}

export default AuthMiddleware;
