import express from 'express';
import { validate } from '../../../shared/validation/validate';
import {
  AvatarListQuery,
  AvatarThemeListQuery,
  CityListQuery,
  CountryListQuery,
  DepartmentListQuery,
  GenderListQuery,
  NotificationTypeCatalogListQuery,
  PhonePrefixListQuery,
  RoleListQuery
} from '../requests/maintainers.request';
const router = express.Router();
import MaintainersController from '../controllers/maintainers.controller';
import RateLimitMiddleware from '../../../shared/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../shared/http/request-lock.middleware';

/**
 * TODAS LAS RUTAS SON PÚBLICAS — no requieren autenticación
 */

// === RF-LP-01: Landing Page & UX Pública — Endpoints públicos sin autenticación ===

router.get(
  '/maintainers/genders',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: GenderListQuery }),
  MaintainersController.listGenders
);

router.get(
  '/maintainers/document-types',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  MaintainersController.listDocumentTypes
);

router.get(
  '/maintainers/phone-prefixes',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: PhonePrefixListQuery }),
  MaintainersController.listPhonePrefixes
);

router.get(
  '/maintainers/countries',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: CountryListQuery }),
  MaintainersController.listCountries
);

router.get(
  '/maintainers/departments',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: DepartmentListQuery }),
  MaintainersController.listDepartments
);

router.get(
  '/maintainers/cities',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: CityListQuery }),
  MaintainersController.listCities
);

router.get(
  '/maintainers/avatars',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: AvatarListQuery }),
  MaintainersController.listAvatars
);

router.get(
  '/maintainers/avatar-themes',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: AvatarThemeListQuery }),
  MaintainersController.listAvatarThemes
);

router.get(
  '/maintainers/notification-types',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: NotificationTypeCatalogListQuery }),
  MaintainersController.listNotificationTypes
);

router.get(
  '/maintainers/roles',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  validate({ query: RoleListQuery }),
  MaintainersController.listRoles
);

/**
 * GET /api/maintainers/privacy-policy/active
 * Retorna la versión activa de la política de privacidad.
 * Ruta pública — el front la llama antes del registro para mostrar el PDF.
 */
router.get(
  '/maintainers/privacy-policy/active',
  RateLimitMiddleware.publicLimiter(),
  RequestLockMiddleware.forPublicEndpoints(),
  MaintainersController.getActivePrivacyPolicy
);

export default router;
