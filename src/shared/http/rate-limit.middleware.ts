// shared/middlewares/rate-limit.middleware.ts

import { interopDefault } from '../utils/interop.util';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import redisClient from '../infra/redis.util';
import ApiResponse from './app-response.util';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../constants';
const { RATE_LIMIT, ASSISTANT_RATE_LIMIT, FORGOT_PASSWORD_RATE_LIMIT } = constantsModule;
import errorMessageModule from '../utils/error-message.util';

const { errorMessage } = errorMessageModule;


// ==============================================
// HYBRID STORE — Redis con fallback a memoria
// ==============================================

/** Contador en memoria (fallback cuando Redis no está disponible). */
interface MemoryEntry {
  hits: number;
  resetTime: number;
}

class HybridStore {
  readonly prefix: string;
  readonly windowMs: number;
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(prefix: string, windowMs: number) {
    this.prefix = prefix;
    this.windowMs = windowMs;

    // Limpieza periódica de entradas expiradas en memoria
    setInterval(() => this._cleanup(), RATE_LIMIT.ONE_MINUTE_MS).unref();
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, data] of this.memory.entries()) {
      if (data.resetTime < now) {
        this.memory.delete(key);
      }
    }
  }

  async increment(key: string) {
    const fullKey = `${this.prefix}${key}`;

    if (redisClient.isAvailable()) {
      try {
        return await this._incrementRedis(fullKey);
      } catch (error) {
        logger.warn('RateLimit — Redis increment failed, using memory', { error: errorMessage(error) });
      }
    }

    return this._incrementMemory(key);
  }

  async _incrementRedis(key: string) {
    // Se llama solo tras comprobar isAvailable(): el cliente existe
    const client = redisClient.getClient()!;
    const count = await client.incr(key);
    if (count === 1) {
      await client.pexpire(key, this.windowMs);
    }
    return { totalHits: count, resetTime: new Date(Date.now() + this.windowMs) };
  }

  _incrementMemory(key: string) {
    const now = Date.now();
    const data = this.memory.get(key);

    if (!data || data.resetTime < now) {
      const entry = { hits: 1, resetTime: now + this.windowMs };
      this.memory.set(key, entry);
      return { totalHits: 1, resetTime: new Date(entry.resetTime) };
    }

    data.hits++;
    return { totalHits: data.hits, resetTime: new Date(data.resetTime) };
  }

  async decrement(key: string) {
    const fullKey = `${this.prefix}${key}`;
    if (redisClient.isAvailable()) {
      try {
        await redisClient.getClient()!.decr(fullKey);
        return;
      } catch (error) {
        logger.warn('RateLimit — Redis decrement failed', { error: errorMessage(error) });
      }
    }
    const data = this.memory.get(key);
    if (data && data.hits > 0) {
      data.hits--;
    }
  }

  async resetKey(key: string) {
    const fullKey = `${this.prefix}${key}`;
    if (redisClient.isAvailable()) {
      try {
        await redisClient.getClient()!.del(fullKey);
      } catch (error) {
        logger.warn('RateLimit — Redis resetKey failed', { error: errorMessage(error) });
      }
    }
    this.memory.delete(key);
  }
}

// ==============================================
// HELPERS
// ==============================================

// IP del cliente. Se confía en req.ip, que Express deriva del X-Forwarded-For
// respetando `trust proxy` (configurado en src/app.ts). NO leer X-Forwarded-For
// ni X-Real-IP directamente: son controlados por el cliente y permitirían evadir
// los límites/bloqueos por IP rotando el header en cada request.
const getClientIp = (req: Request) => req.ip || req.socket?.remoteAddress || 'unknown-ip';

// Refresh token del request: cookie en web, header en mobile. Mismo orden de lectura que el
// controller de auth, para que el limiter agrupe por la misma sesión que se va a renovar.
const getRefreshToken = (req: Request): string | null => {
  const header = req.headers['x-refresh-token'];
  return req.cookies?.refresh_token || (Array.isArray(header) ? header[0] : header) || null;
};

// ==============================================
// RATE LIMIT MIDDLEWARE
// ==============================================

class RateLimitMiddleware {
  /**
   * Limiter general para endpoints públicos.
   * Clave: IP del cliente.
   */
  static publicLimiter() {
    // [RF-LP-01] | CA-01 | Rate limit 100 req/15min por IP — protege endpoints públicos de abuso
    return rateLimit({
      windowMs: RATE_LIMIT.WINDOW_MS,
      max: RATE_LIMIT.MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      store: new HybridStore('rl:public:', RATE_LIMIT.WINDOW_MS),
      keyGenerator: (req: Request) => getClientIp(req),
      handler: (req: Request, res: Response) => {
        logger.info('Rate limit exceeded (public)', {
          ip: getClientIp(req),
          path: req.path,
          usingRedis: redisClient.isAvailable()
        });
        return ApiResponse.tooManyRequests(res, 'Demasiadas peticiones. Intenta más tarde');
      }
    });
  }

  /**
   * Limiter del chat público del asistente (Assistant).
   * Clave: IP del cliente.
   *
   * Más ajustado que publicLimiter porque cada request tiene costo marginal real en tokens del
   * proveedor de IA — a diferencia del resto de endpoints públicos, que solo cuestan CPU.
   */
  static assistantLimiter() {
    // [RF-INT-14] | CA-02 | Rate limit propio del chat: 30 req/15min por IP
    return rateLimit({
      windowMs: ASSISTANT_RATE_LIMIT.WINDOW_MS,
      max: ASSISTANT_RATE_LIMIT.MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      store: new HybridStore('rl:assistant:', ASSISTANT_RATE_LIMIT.WINDOW_MS),
      keyGenerator: (req: Request) => getClientIp(req),
      handler: (req: Request, res: Response) => {
        logger.info('Rate limit exceeded (assistant)', {
          ip: getClientIp(req),
          path: req.path,
          usingRedis: redisClient.isAvailable()
        });
        return ApiResponse.tooManyRequests(res, 'Alcanzaste el límite de mensajes. Intenta más tarde');
      }
    });
  }

  /**
   * Limiter estricto para endpoints de autenticación.
   * Clave: email del body si existe, sino IP.
   */
  static authLimiter() {
    return rateLimit({
      windowMs: RATE_LIMIT.AUTH_WINDOW_MS,
      max: RATE_LIMIT.AUTH_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false,
      store: new HybridStore('rl:auth:', RATE_LIMIT.AUTH_WINDOW_MS),
      keyGenerator: (req: Request) => {
        const email = req.body?.email || req.body?.username;
        if (email && typeof email === 'string') {
          return `email:${email.toLowerCase()}`;
        }
        return `ip:${getClientIp(req)}`;
      },
      handler: (req: Request, res: Response) => {
        logger.warn('Rate limit exceeded (auth)', {
          ip: getClientIp(req),
          email: req.body?.email,
          path: req.path,
          usingRedis: redisClient.isAvailable()
        });
        return ApiResponse.tooManyRequests(res, 'Demasiados intentos de autenticación. Intenta en 15 minutos');
      }
    });
  }

  /**
   * Limiter de /auth/refresh. Clave: sessionId del refresh token; IP solo como fallback
   * cuando no hay token decodificable (request malformado, que muere igual río abajo).
   *
   * Por qué no reusa authLimiter(): su keyGenerator cae a `ip:` cuando el body no trae email
   * —y el refresh manda el token por cookie, nunca en el body—, así que todos los usuarios
   * detrás de una misma IP pública compartían un cupo de 10/15min y se dejaban sin renovar
   * entre sí. El refresh se llama en bucle por diseño; su límite tiene que ser por sesión.
   */
  // [RF-AUTH-02] | CA-01 | Rate limit del refresh por sesión (30/15min), no por IP
  static refreshLimiter() {
    return rateLimit({
      windowMs: RATE_LIMIT.REFRESH_WINDOW_MS,
      max: RATE_LIMIT.REFRESH_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false,
      store: new HybridStore('rl:refresh:', RATE_LIMIT.REFRESH_WINDOW_MS),
      keyGenerator: (req: Request) => {
        // Lazy require: jwt.util carga las claves RS256 al primer uso y este módulo se
        // evalúa durante el arranque de la app.
        const JwtUtil = interopDefault(require('../security/jwt.util') as typeof import('../security/jwt.util'));
        const payload = JwtUtil.decodeUnverified(getRefreshToken(req));
        if (payload?.sessionId) {
          return `session:${payload.sessionId}`;
        }
        return `ip:${getClientIp(req)}`;
      },
      handler: (req: Request, res: Response) => {
        logger.warn('Rate limit exceeded (refresh)', {
          ip: getClientIp(req),
          path: req.path,
          usingRedis: redisClient.isAvailable()
        });
        return ApiResponse.tooManyRequests(res, 'Demasiadas renovaciones de sesión. Intenta en unos minutos');
      }
    });
  }

  /**
   * Limiter estricto para el endpoint de recuperación de contraseña.
   * Clave: IP del cliente. Máximo 3 solicitudes por hora.
   */
  // [RF-AUTH-02] | CA-03 | Rate limiting para solicitud de recuperación: 3/hora por IP
  static forgotPasswordLimiter() {
    return rateLimit({
      windowMs: FORGOT_PASSWORD_RATE_LIMIT.WINDOW_MS,
      max: FORGOT_PASSWORD_RATE_LIMIT.MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      store: new HybridStore('rl:forgot-pwd:', FORGOT_PASSWORD_RATE_LIMIT.WINDOW_MS),
      keyGenerator: (req: Request) => getClientIp(req),
      handler: (req: Request, res: Response) => {
        logger.warn('Rate limit exceeded (forgot-password)', {
          ip: getClientIp(req),
          path: req.path
        });
        return ApiResponse.tooManyRequests(res, 'Demasiadas solicitudes de recuperación. Intenta nuevamente en 1 hora');
      }
    });
  }

  // Para rutas autenticadas que no son login
  static apiLimiter() {
    return rateLimit({
      windowMs: RATE_LIMIT.API_WINDOW_MS,
      max: RATE_LIMIT.API_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      store: new HybridStore('rl:api:', RATE_LIMIT.API_WINDOW_MS),
      keyGenerator: (req: Request) => getClientIp(req),
      handler: (req: Request, res: Response) => {
        logger.info('Rate limit exceeded (api)', {
          ip: getClientIp(req),
          path: req.path
        });
        return ApiResponse.tooManyRequests(res, 'Demasiadas peticiones. Intenta más tarde');
      }
    });
  }
}

export default RateLimitMiddleware;
