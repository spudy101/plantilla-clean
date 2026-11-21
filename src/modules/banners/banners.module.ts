// Composición del módulo banners: el ÚNICO archivo del módulo que conoce todas sus capas.
//
//   Prisma (catálogo) + S3 (imágenes) ──► casos de uso ──► controllers ──► routers admin y público
//
// Lo que viene de afuera (auditoría, logger, ids, caché, guardas) llega por parámetro desde src/main/.
import type { Router } from 'express';
import type { AuditTrail } from '../../shared/application/ports/audit-trail.port';
import type { IdGenerator } from '../../shared/application/ports/id-generator.port';
import type { KeyValueCache } from '../../shared/application/ports/key-value-cache.port';
import type { Logger } from '../../shared/application/ports/logger.port';
import type { RouteGuards } from '../../shared/presentation/http/route-guards';
import { PrismaBannerCatalogRepository } from './infrastructure/persistence/prisma-banner-catalog.repository';
import { S3BannerImageStorage } from './infrastructure/storage/s3-banner-image.storage';
import { ListAdminBanners } from './application/use-cases/list-admin-banners.use-case';
import { ReplaceBanners } from './application/use-cases/replace-banners.use-case';
import { UploadBannerImage } from './application/use-cases/upload-banner-image.use-case';
import { ListPublicBanners } from './application/use-cases/list-public-banners.use-case';
import { AdminPromotionalBannerController } from './presentation/http/admin-promotional-banner.controller';
import { PublicPromotionalBannerController } from './presentation/http/promotional-banner.controller';
import { createAdminPromotionalBannerRouter } from './presentation/http/admin-promotional-banner.routes';
import { createPublicPromotionalBannerRouter } from './presentation/http/promotional-banner.routes';

export interface BannersModuleDeps {
  audit: AuditTrail;
  logger: Logger;
  ids: IdGenerator;
  /** Caché del listado público (en memoria del proceso: 60 s). */
  cache: KeyValueCache;
  guards: RouteGuards;
}

export interface BannersModule {
  adminRouter: Router;
  publicRouter: Router;
}

export function createBannersModule({ audit, logger, ids, cache, guards }: BannersModuleDeps): BannersModule {
  const catalogs = new PrismaBannerCatalogRepository();
  const images = new S3BannerImageStorage(ids);

  const adminController = new AdminPromotionalBannerController(
    new ListAdminBanners(catalogs, audit),
    new ReplaceBanners(catalogs, images, ids, audit, logger),
    new UploadBannerImage(images, audit)
  );
  const publicController = new PublicPromotionalBannerController(new ListPublicBanners(catalogs, cache, audit));

  return {
    adminRouter: createAdminPromotionalBannerRouter(adminController, guards),
    publicRouter: createPublicPromotionalBannerRouter(publicController)
  };
}
