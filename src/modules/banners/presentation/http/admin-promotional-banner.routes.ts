// Rutas del mantenedor admin de banners (RBAC: módulo promotionalContent). El router se arma con el
// controlador y las guardas que recibe: no importa el módulo iam.
import express from 'express';
import type { Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import UploadMiddleware from '../../../../shared/presentation/http/upload.middleware';
import type { RouteGuards } from '../../../../shared/presentation/http/route-guards';
import rbacModule from '../../../../shared/domain/constants/rbac';
import { ReplaceBannersBody, BannerImageFiles } from './requests/admin-promotional-banner.request';
import type { AdminPromotionalBannerController } from './admin-promotional-banner.controller';

const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;

export function createAdminPromotionalBannerRouter(controller: AdminPromotionalBannerController, guards: RouteGuards): Router {
  const router = express.Router();
  const protect = (action: string) => [
    guards.authenticate,
    guards.requirePermission(RBAC_MODULES.PROMOTIONAL_CONTENT, action),
    RateLimitMiddleware.apiLimiter(),
    RequestLockMiddleware.forAuthenticatedUsers()
  ];

  router.get('/promotional-banners', ...protect(RBAC_ACTIONS.READ), controller.list);

  router.put('/promotional-banners', ...protect(RBAC_ACTIONS.UPDATE), validate({ body: ReplaceBannersBody }), controller.replace);

  router.post(
    '/promotional-banners/image',
    ...protect(RBAC_ACTIONS.CREATE),
    UploadMiddleware.uploadFields([{ name: 'image', maxCount: 1 }], { maxFileSize: UploadMiddleware.MAX_IMAGE_SIZE }),
    UploadMiddleware.handleMulterError,
    validate({ files: BannerImageFiles }),
    controller.uploadImage
  );

  return router;
}
