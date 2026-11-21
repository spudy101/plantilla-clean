// Capa IP del endpoint de login (RF-AUTH-02 CA-05): si la IP está bloqueada → 429 + Retry-After; cada
// intento suma al contador y, al superar el límite, la IP queda bloqueada (ver LoginRateLimiter).
import type { NextFunction, Request, Response } from 'express';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import LoginRateLimiter from '../utils/login-rate-limiter.util';

const SECONDS_PER_MINUTE = 60;

const tooManyRequests = (seconds: number) =>
  AppError.tooManyRequests(
    `Demasiados intentos desde esta IP. Intenta nuevamente en ${Math.ceil(seconds / SECONDS_PER_MINUTE)} minuto(s)`,
    null,
    seconds
  );

function loginIpLimiter() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown-ip';

    const blockedSecs = await LoginRateLimiter.checkIpBlock(ip);
    if (blockedSecs !== null) {
      logger.warn('Rate limit: IP bloqueada en /login', { ip, retryAfter: blockedSecs });
      return next(tooManyRequests(blockedSecs));
    }

    const newBlockSecs = await LoginRateLimiter.incrementIpAttempts(ip);
    if (newBlockSecs !== null) {
      logger.warn('Rate limit: IP bloqueada tras superar límite en /login', { ip, retryAfter: newBlockSecs });
      return next(tooManyRequests(newBlockSecs));
    }
    return next();
  };
}

export default { loginIpLimiter };
