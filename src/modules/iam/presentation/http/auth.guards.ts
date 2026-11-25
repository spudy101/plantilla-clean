// Las guardas HTTP de iam: quién llama (authenticate, optionalAuthenticate, requireRole), qué puede hacer
// (requirePermission, RBAC por módulo + acción) y quién no es un usuario (otro sistema por X-API-Key, un webhook por
// apikey en la query). Más el límite por IP del login.
//
// Leen el request (cookies, headers) y llaman a los casos de uso de autenticación; no tienen reglas. Las rutas de
// iam las usan directo y src/main/ se las entrega a los demás módulos como RouteGuards.
//
// Mobile firma cada request con HMAC-SHA256 (`timestamp:method:path` con el secreto de su dispositivo):
//   x-timestamp (unix ms en texto plano), x-signature (hex), x-device-id (la huella del dispositivo).
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import AppError from '../../../../shared/presentation/http/app-error.util';
import { isExpectedError } from '../../../../shared/application/errors';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import errorMessageModule from '../../../../shared/kernel/error-message.util';
import type {
  AuthenticateRequest,
  AuthorizePermission,
  RequirePrivilegedMfa,
  ThrottleLoginByIp,
  VerifyExternalApiKey
} from '../../application/use-cases/authentication.use-cases';

const { errorMessage } = errorMessageModule;

const API_KEY_LOG_LENGTH = 24;

/** Un header de Express puede venir repetido (string[]): se toma el primer valor. */
const headerValue = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** ¿El error ya dice qué responder? (si no, la autenticación responde un 401 genérico). */
const isKnown = (error: unknown) => error instanceof AppError || isExpectedError(error);

export interface AuthGuardUseCases {
  authenticate: AuthenticateRequest;
  privilegedMfa: RequirePrivilegedMfa;
  authorize: AuthorizePermission;
  externalApiKey: VerifyExternalApiKey;
  throttleLoginIp: ThrottleLoginByIp;
}

export class AuthGuards {
  constructor(
    private readonly useCases: AuthGuardUseCases,
    private readonly logger: Logger
  ) {}

  /** Exige un usuario autenticado (deja req.user). */
  authenticate: RequestHandler = async (req, _res, next) => {
    try {
      await this.performAuthentication(req, false);
      next();
    } catch (error) {
      next(isKnown(error) ? error : AppError.unauthorized('Error al autenticar usuario'));
    }
  };

  /** Exige un usuario autenticado con uno de `allowedRoles` (y, si es interno, con 2FA activo). */
  requireRole(allowedRoles: readonly string[] = []): RequestHandler {
    return async (req, _res, next) => {
      try {
        const user = await this.performAuthentication(req, true);
        if (!user.roleName || !allowedRoles.includes(user.roleName)) {
          this.logger.warn('Access denied — insufficient role', { userId: user.userId, userRole: user.roleName, allowedRoles, path: req.path });
          throw AppError.forbidden('No tienes permisos para acceder a este recurso');
        }
        // RF-ADM-01 #6 — los internos deben tener 2FA activo para operar
        await this.useCases.privilegedMfa.execute(req.user?.roleName, req.user?.userId, req.path);
        next();
      } catch (error) {
        next(isKnown(error) ? error : AppError.unauthorized('Error al autenticar usuario'));
      }
    };
  }

  /**
   * Autenticación OPCIONAL — para endpoints PÚBLICOS que, si además hay sesión, atienden mejor al titular. **Nunca
   * falla**: sin credenciales, o con credenciales inválidas o vencidas, sigue como anónimo (el navegador conserva
   * cookies de sesiones viejas y los clientes HTTP adjuntan Authorization por interceptor). Si la autenticación falló
   * a mitad de camino, `req.user` se limpia: río abajo hay "sesión válida" o "no hay sesión", nunca un estado a medias.
   */
  optionalAuthenticate: RequestHandler = async (req, _res, next) => {
    if (!req.cookies?.access_token && !req.headers.authorization) {
      return next();
    }
    try {
      await this.performAuthentication(req, false);
    } catch (error) {
      delete req.user;
      this.useCases.authenticate.clearSession();
      this.logger.debug('optionalAuthenticate: credenciales inválidas — se continúa como anónimo', { error: errorMessage(error) });
    }
    return next();
  };

  /** Exige el permiso `action` sobre el módulo RBAC `moduleName` (authenticate debe haber corrido antes). */
  requirePermission(moduleName: string, action: string): RequestHandler {
    return async (req, _res, next) => {
      try {
        await this.useCases.authorize.execute({
          roleName: req.user?.roleName,
          userId: req.user?.userId,
          moduleName,
          action,
          path: req.originalUrl
        });
        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  /** Otro sistema, por X-API-Key. */
  externalAuthenticate: RequestHandler = (req, _res, next) => {
    try {
      const apiKey = req.header('X-API-Key');
      if (!this.useCases.externalApiKey.execute(apiKey)) {
        this.logger.warn('AuthMiddleware: API Key externa inválida', { service: 'external' });
        return next(AppError.unauthorized('API Key inválida'));
      }
      req.externalService = apiKey.slice(0, API_KEY_LOG_LENGTH);
      return next();
    } catch (error) {
      this.logger.error('AuthMiddleware: error en autenticación externa', { error: errorMessage(error) });
      return next(AppError.internal('Error en autenticación externa'));
    }
  };

  /** Un webhook, por apikey en la query (el parámetro repetido o como objeto no se acepta). */
  externalWebhookAuthenticate: RequestHandler = (req, _res, next) => {
    try {
      const rawKey = req.query.apiKey || req.query.api_key || req.query.key;
      const apiKey = typeof rawKey === 'string' ? rawKey : undefined;
      if (!this.useCases.externalApiKey.execute(apiKey)) {
        this.logger.warn('AuthMiddleware: API Key de webhook inválida', { service: 'webhook' });
        return next(AppError.unauthorized('API Key inválida'));
      }
      req.externalService = 'webhook';
      return next();
    } catch (error) {
      this.logger.error('AuthMiddleware: error en autenticación de webhook', { error: errorMessage(error) });
      return next(AppError.internal('Error en autenticación de webhook'));
    }
  };

  /** Capa IP del login: 429 + Retry-After si la IP está (o queda) bloqueada. */
  loginIpLimiter(): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        await this.useCases.throttleLoginIp.execute(req.ip || req.socket?.remoteAddress || 'unknown-ip');
        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  /** Autentica y deja el usuario en `req.user`; lo devuelve para que el llamador no dependa de `req.user!`. */
  private async performAuthentication(req: Request, requireRole: boolean) {
    const cookieAccessToken = req.cookies?.access_token;
    const canal: 'web' | 'mobile' = cookieAccessToken ? 'web' : 'mobile';
    const accessToken: string = cookieAccessToken ? cookieAccessToken : extractBearerToken(req);

    const user = await this.useCases.authenticate.execute({
      accessToken,
      canal,
      requireRole,
      fingerprintHash: req.res?.locals?.fingerprintHash,
      path: req.originalUrl,
      signature: {
        timestamp: headerValue(req.headers['x-timestamp']),
        signature: headerValue(req.headers['x-signature']),
        deviceId: headerValue(req.headers['x-device-id']),
        method: req.method,
        path: req.path || req.originalUrl?.split('?')[0] || '/',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    });
    req.user = user;
    await this.useCases.authenticate.afterAuthenticated(user);
    return user;
  }
}

function extractBearerToken(req: Request): string {
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
