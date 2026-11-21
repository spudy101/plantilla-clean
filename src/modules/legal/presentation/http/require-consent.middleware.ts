// Middleware de ruta: exige que el usuario autenticado tenga vigente un consentimiento OBLIGATORIO antes de
// seguir (ver application/use-cases/verify-consent.use-case.ts). Uso, desde la composición:
//
//   router.get('/datos-de-terceros', guards.authenticate, legal.requireConsent('PRIVACY_POLICY'), handler)
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import AppError from '../../../../shared/presentation/http/app-error.util';
import errorMiddlewareModule from '../../../../shared/presentation/http/error.middleware';
import { OptionalConsentGateError, type VerifyConsent } from '../../application/use-cases/verify-consent.use-case';

const { asyncHandler } = errorMiddlewareModule;

export type RequireConsent = (consentTypeCode: string) => RequestHandler;

export function createRequireConsent(verifyConsent: VerifyConsent): RequireConsent {
  return consentTypeCode =>
    asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
      const userId = req.user?.userId;
      if (!userId) {
        throw AppError.unauthorized('Token requerido');
      }
      try {
        await verifyConsent.execute({ userId, consentTypeCode });
      } catch (error) {
        // Exigir un consentimiento opcional es un error de configuración de la ruta: 500, no culpa del usuario
        if (error instanceof OptionalConsentGateError) {
          throw AppError.internal(error.message, { code: 'CONSENT_MIDDLEWARE_MISCONFIGURATION' });
        }
        throw error;
      }
      next();
    });
}
