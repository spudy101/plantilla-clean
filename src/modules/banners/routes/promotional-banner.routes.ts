import express from 'express';
const router = express.Router();
import PromotionalBannerPublicController from '../controllers/promotional-banner.controller';
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';

// Público (sin authenticate, patrón del formulario de contacto): la landing y la app cliente
// consumen el mismo endpoint. publicLimiter = límite estricto anti-abuso para rutas sin sesión.
router.get(
  '/promotional-banners',
  RateLimitMiddleware.publicLimiter(),
  PromotionalBannerPublicController.list
);

export default router;
