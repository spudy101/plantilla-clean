// shared/middlewares/security.middleware.ts

import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../constants';
const { server } = constantsModule;

class SecurityMiddleware {
  /**
   * Helmet — configura headers de seguridad HTTP.
   */
  static helmet() {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:']
        }
      },
      // [RF-LP-01] | CA-05 | HSTS: fuerza HTTPS por 1 año con preload — complementa redirección HTTP→HTTPS del ALB
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      },
      frameguard: { action: 'deny' },
      noSniff: true,
      xssFilter: true
    });
  }

  /**
   * CORS — soporta string único o lista separada por comas.
   * Ej: CORS_ORIGIN="https://app.com,https://admin.app.com"
   *
   * IMPORTANTE: credentials: true es requerido para que el browser
   * envíe cookies httpOnly en requests con withCredentials.
   * Cuando credentials: true, el origin NO puede ser '*' — el browser
   * lo rechaza. En desarrollo se usa el origin reflejado.
   */
  static cors() {
    const whitelist = server.corsOrigin === '*' ? '*' : server.corsOrigin.split(',').map(o => o.trim());

    return cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
        // Requests sin origin (apps móviles, curl, Postman) — siempre permitir
        if (!origin) {
          return callback(null, true);
        }

        // Desarrollo — reflejar el origin exacto (no usar '*' por credentials: true)
        if (server.nodeEnv === 'development') {
          return callback(null, origin);
        }

        // Producción con whitelist '*' — INSEGURO con credentials: true.
        // Reflejar cualquier origin permitiría a sitios de terceros hacer requests
        // autenticados con las cookies del usuario. Se exige whitelist explícita:
        // los requests cross-origin se bloquean hasta configurar CORS_ORIGIN.
        if (whitelist === '*') {
          logger.warn('CORS bloqueado — CORS_ORIGIN="*" no permitido en producción. Configura orígenes explícitos.', {
            origin
          });
          return callback(new Error('No permitido por CORS'));
        }

        // Producción con whitelist explícita — verificar
        if (whitelist.includes(origin)) {
          return callback(null, true);
        }

        logger.warn('CORS blocked request', { origin });
        return callback(new Error('No permitido por CORS'));
      },
      credentials: true, // ← requerido para cookies httpOnly con withCredentials
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'x-timestamp',
        'x-refresh-token',
        'last-event-id',
        'Accept',
        'X-API-Key',
        'x-id-token',
        'x-client-type'
      ],
      // Retry-After / RateLimit-*: el front necesita leerlos para reintentar bien (sin exponerlos, el
      // navegador los oculta en respuestas cross-origin). Idempotent-Replayed: la respuesta es la guardada.
      exposedHeaders: [
        'X-Total-Count',
        'X-Page',
        'X-Limit',
        'X-Correlation-Id',
        'Retry-After',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'Idempotent-Replayed'
      ],
      maxAge: 86400 // 24 horas — preflight cacheado en el browser
    });
  }

  /**
   * Headers de seguridad adicionales (complementa Helmet).
   */
  static addSecurityHeaders(req: Request, res: Response, next: NextFunction) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.removeHeader('X-Powered-By');
    next();
  }
}

export default SecurityMiddleware;
