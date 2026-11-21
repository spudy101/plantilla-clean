// Ruta pública de banners (sin sesión): la landing y la app cliente consumen el mismo endpoint.
// publicLimiter = límite estricto anti-abuso para rutas sin sesión.
import express from 'express';
import type { Router } from 'express';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import type { PublicPromotionalBannerController } from './promotional-banner.controller';

export function createPublicPromotionalBannerRouter(controller: PublicPromotionalBannerController): Router {
  const router = express.Router();
  router.get('/promotional-banners', RateLimitMiddleware.publicLimiter(), controller.list);
  return router;
}
