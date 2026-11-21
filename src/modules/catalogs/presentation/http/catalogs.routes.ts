// Rutas HTTP de catálogos. TODAS SON PÚBLICAS (sin autenticación): el formulario de registro las usa
// antes de que exista una sesión. Por eso llevan rate limit público y bloqueo de peticiones duplicadas.
import express from 'express';
import type { RequestHandler, Router } from 'express';
import { validate } from '../../../../shared/presentation/validation/validate';
import RateLimitMiddleware from '../../../../shared/presentation/http/rate-limit.middleware';
import RequestLockMiddleware from '../../../../shared/presentation/http/request-lock.middleware';
import * as requests from './requests/catalog-list.request';
import type { CatalogsController } from './catalogs.controller';

type QuerySchema = Parameters<typeof validate>[0]['query'];

export function createCatalogsRouter(controller: CatalogsController): Router {
  const router = express.Router();
  const publicRoute = (path: string, handler: RequestHandler, query?: QuerySchema) =>
    router.get(
      path,
      RateLimitMiddleware.publicLimiter(),
      RequestLockMiddleware.forPublicEndpoints(),
      ...(query ? [validate({ query })] : []),
      handler
    );

  publicRoute('/maintainers/genders', controller.listGenders, requests.GenderListQuery);
  publicRoute('/maintainers/document-types', controller.listDocumentTypes);
  publicRoute('/maintainers/phone-prefixes', controller.listPhonePrefixes, requests.PhonePrefixListQuery);
  publicRoute('/maintainers/countries', controller.listCountries, requests.CountryListQuery);
  publicRoute('/maintainers/departments', controller.listDepartments, requests.DepartmentListQuery);
  publicRoute('/maintainers/cities', controller.listCities, requests.CityListQuery);
  publicRoute('/maintainers/avatars', controller.listAvatars, requests.AvatarListQuery);
  publicRoute('/maintainers/avatar-themes', controller.listAvatarThemes, requests.AvatarThemeListQuery);
  publicRoute('/maintainers/notification-types', controller.listNotificationTypes, requests.NotificationTypeCatalogListQuery);
  publicRoute('/maintainers/roles', controller.listRoles, requests.RoleListQuery);
  // El front la pide antes del registro para mostrar el PDF de la política
  publicRoute('/maintainers/privacy-policy/active', controller.getActivePrivacyPolicy);

  return router;
}
