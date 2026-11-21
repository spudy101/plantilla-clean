import express from 'express';
const router = express.Router();
import PromotionalBannerController from '../controllers/admin-promotional-banner.controller';
import { ReplaceBannersBody, BannerImageFiles } from '../requests/admin-promotional-banner.request';
import { validate } from '../../../shared/presentation/validation/validate';
import iamModule from '../../iam';
const { AuthMiddleware, RbacMiddleware } = iamModule;
import RateLimitMiddleware from '../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/presentation/http/request-lock.middleware';
import UploadMiddleware from '../../../shared/presentation/http/upload.middleware';
import rbacModule from '../../../shared/domain/constants/rbac';
const { RBAC_MODULES, RBAC_ACTIONS } = rbacModule;


// Mantenedor admin de banners promocionales (landing pública + app cliente).
router.get(
  '/promotional-banners',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PROMOTIONAL_CONTENT, RBAC_ACTIONS.READ),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  PromotionalBannerController.list
);

router.put(
  '/promotional-banners',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PROMOTIONAL_CONTENT, RBAC_ACTIONS.UPDATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  validate({ body: ReplaceBannersBody }),
  PromotionalBannerController.replace
);

router.post(
  '/promotional-banners/image',
  AuthMiddleware.authenticate,
  RbacMiddleware.requirePermission(RBAC_MODULES.PROMOTIONAL_CONTENT, RBAC_ACTIONS.CREATE),
  RateLimitMiddleware.apiLimiter(),
  RequestLockMiddleware.forAuthenticatedUsers(),
  UploadMiddleware.uploadFields([{ name: 'image', maxCount: 1 }], { maxFileSize: UploadMiddleware.MAX_IMAGE_SIZE }),
  UploadMiddleware.handleMulterError,
  validate({ files: BannerImageFiles }),
  PromotionalBannerController.uploadImage
);

export default router;
