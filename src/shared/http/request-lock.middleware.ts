// src/middlewares/request-lock.middleware.ts

import { interopDefault } from '../utils/interop.util';
import type { NextFunction, Request, Response } from 'express';
import redisClient from '../infra/redis.util';
import localCache from '../infra/cache.util';
import EncryptionUtil from '../security/encryption.util';
import ApiResponse from './app-response.util';
import authUserUtil from './auth-user.util';

const { requireAuthUser } = authUserUtil;
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../constants';
const { TTL, HTTP_STATUS } = constantsModule;
import errorMessageModule from '../utils/error-message.util';

const { errorMessage } = errorMessageModule;


/**
 * Request Lock — previene requests duplicados concurrentes.
 *
 * MEJORA: el lock es por IP/userId + ruta específica.
 * Antes: si el front hacía /perfil y /account al mismo tiempo, uno caía.
 * Ahora: cada ruta tiene su propio lock independiente.
 *
 * Clave para usuarios autenticados: lock:user:{hash(userId + method + path + body)}
 * Clave para endpoints públicos:    lock:ip:{hash(ip + method + path + body)}
 *
 * Dos requests simultáneos a /perfil y /account generan dos keys distintas
 * y nunca se bloquean entre sí.
 */
class RequestLockMiddleware {
  /**
   * Lock para rutas autenticadas (requiere JWT).
   * Identifica al usuario por userId + ruta.
   *
   * @param {{ ttl?: number }} options
   */
  static forAuthenticatedUsers(options: { ttl?: number } = {}) {
    const lockTtl = options.ttl || TTL.REQUEST_LOCK;

    return async (req: Request, res: Response, next: NextFunction) => {
      if (!req.user?.userId) {
        logger.warn('RequestLock — forAuthenticatedUsers usado sin JWT, omitiendo lock');
        return next();
      }

      try {
        const lockKey = RequestLockMiddleware._buildUserLockKey(req);
        const acquired = await RequestLockMiddleware._acquireLock(lockKey, lockTtl);

        if (!acquired) {
          logger.info('RequestLock — duplicate request blocked (user)', {
            userId: req.user.userId,
            method: req.method,
            path: req.path
          });
          return RequestLockMiddleware._inProgress(res, 'Petición duplicada detectada. Espera un momento', lockTtl);
        }

        req.lockKey = lockKey;
        res.on('finish', () => RequestLockMiddleware._releaseLock(lockKey));
        return next();
      } catch (error) {
        logger.warn('RequestLock — error en lock de usuario', { error: errorMessage(error) });
        return next(); // Ante error, dejamos pasar para no bloquear la app
      }
    };
  }

  /**
   * Lock para rutas públicas (sin JWT).
   * Identifica al cliente por IP + ruta.
   *
   * @param {{ ttl?: number }} options
   */
  static forPublicEndpoints(options: { ttl?: number } = {}) {
    // [RF-LP-01] | CA-01 | Deduplicación de requests concurrentes en rutas públicas — TTL 3s
    const lockTtl = options.ttl || TTL.REQUEST_LOCK_PUBLIC;

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const lockKey = RequestLockMiddleware._buildIpLockKey(req);
        const acquired = await RequestLockMiddleware._acquireLock(lockKey, lockTtl);

        if (!acquired) {
          logger.info('RequestLock — duplicate request blocked (public)', {
            ip: req.ip,
            method: req.method,
            path: req.path
          });
          return RequestLockMiddleware._inProgress(res, 'Petición duplicada. Espera unos segundos', lockTtl);
        }

        req.lockKey = lockKey;
        res.on('finish', () => RequestLockMiddleware._releaseLock(lockKey));
        return next();
      } catch (error) {
        logger.warn('RequestLock — error en lock público', { error: errorMessage(error) });
        return next();
      }
    };
  }

  /**
   * Lock para /auth/refresh. Deduplica por SESIÓN, no por IP.
   *
   * El endpoint no puede usar forAuthenticatedUsers (no hay req.user: el access token puede estar
   * vencido, que es justo el motivo del refresh) ni forPublicEndpoints (agrupa por IP, y detrás de
   * una IP pública conviven varios usuarios que se bloqueaban entre sí al renovar).
   *
   * Dos refresh de la MISMA sesión dentro del TTL se deduplican —que es la intención original del
   * lock, y lo que provocan las ráfagas del front al montar pantalla—; dos personas distintas
   * renovando en el mismo segundo ya no se pisan.
   *
   * @param {{ ttl?: number }} options
   */
  // [RF-AUTH-02] | CA-01 | Deduplicación del refresh por sesión (TTL 3s)
  static forRefresh(options: { ttl?: number } = {}) {
    const lockTtl = options.ttl || TTL.REQUEST_LOCK_PUBLIC;

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const lockKey = RequestLockMiddleware._buildRefreshLockKey(req);
        const acquired = await RequestLockMiddleware._acquireLock(lockKey, lockTtl);

        if (!acquired) {
          logger.info('RequestLock — duplicate refresh blocked', { method: req.method, path: req.path });
          return RequestLockMiddleware._inProgress(res, 'Renovación de sesión en curso. Espera unos segundos', lockTtl);
        }

        req.lockKey = lockKey;
        res.on('finish', () => RequestLockMiddleware._releaseLock(lockKey));
        return next();
      } catch (error) {
        logger.warn('RequestLock — error en lock de refresh', { error: errorMessage(error) });
        return next();
      }
    };
  }

  // ==============================================
  // PRIVATE HELPERS
  // ==============================================

  /**
   * La misma petición ya está en curso: 409 temporal (`retryable: true`) con Retry-After = lo que dura
   * el lock. No es un 429: no se superó ningún límite, se está esperando a la petición gemela.
   */
  static _inProgress(res: Response, message: string, lockTtlSeconds: number) {
    return ApiResponse.error(res, message, HTTP_STATUS.CONFLICT, 'REQUEST_IN_PROGRESS', null, {
      retryable: true,
      retryAfter: lockTtlSeconds
    });
  }

  /**
   * Lock key del refresh: sessionId del token (sin verificar firma — solo agrupa; el token se
   * valida río abajo). Sin token decodificable cae a la clave por IP, que para un request
   * malformado es suficiente.
   */
  static _buildRefreshLockKey(req: Request) {
    // Lazy require: jwt.util carga las claves RS256 al primer uso.
    const JwtUtil = interopDefault(require('../security/jwt.util') as typeof import('../security/jwt.util'));
    const token = req.cookies?.refresh_token || req.headers['x-refresh-token'] || null;
    const payload = JwtUtil.decodeUnverified(token);

    if (!payload?.sessionId) {
      return RequestLockMiddleware._buildIpLockKey(req);
    }

    return `lock:refresh:${EncryptionUtil.generateHash(payload.sessionId)}`;
  }

  /**
   * Lock key para usuarios autenticados.
   * Incluye ruta en el hash → /perfil y /account son independientes.
   */
  static _buildUserLockKey(req: Request) {
    const payload = {
      userId: requireAuthUser(req).userId,
      method: req.method,
      path: req.path, // ← diferencia por ruta
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : null
    };

    return `lock:user:${EncryptionUtil.generateHash(JSON.stringify(payload))}`;
  }

  /**
   * Lock key para endpoints públicos.
   * Incluye ruta en el hash → /login y /register son independientes.
   */
  static _buildIpLockKey(req: Request) {
    const ip = (req.ip || req.connection?.remoteAddress || 'unknown').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');

    const payload = {
      ip,
      method: req.method,
      path: req.path, // ← diferencia por ruta
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : null
    };
    return `lock:ip:${EncryptionUtil.generateHash(JSON.stringify(payload))}`;
  }

  /**
   * Adquiere el lock de forma atómica.
   * Redis: SET NX (garantiza atomicidad).
   * LocalCache: check-then-set (best-effort, sin garantía estricta).
   *
   * @param {string} key
   * @param {number} ttlSeconds
   * @returns {Promise<boolean>} true si se adquirió, false si ya existía
   */
  static async _acquireLock(key: string, ttlSeconds: number) {
    try {
      if (redisClient.isAvailable()) {
        // isAvailable() garantiza que el cliente existe
        const result = await redisClient.getClient()!.set(key, '1', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      }

      // LocalCache — sin atomicidad garantizada pero suficiente para la mayoría de casos
      if (localCache.exists(key)) {
        return false;
      }
      localCache.set(key, '1', ttlSeconds);
      return true;
    } catch (error) {
      logger.warn('RequestLock — error acquiring lock', { key, error: errorMessage(error) });
      return true; // Ante error en el lock, dejamos pasar
    }
  }

  /**
   * Libera el lock al terminar el request.
   * @param {string} key
   */
  static async _releaseLock(key: string) {
    try {
      if (redisClient.isAvailable()) {
        await redisClient.getClient()!.del(key);
      } else {
        localCache.del(key);
      }
    } catch (error) {
      logger.warn('RequestLock — error releasing lock', { key, error: errorMessage(error) });
    }
  }
}

export default RequestLockMiddleware;
