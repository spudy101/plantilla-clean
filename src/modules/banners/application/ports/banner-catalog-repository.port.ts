// Puerto de persistencia del catálogo de banners. El catálogo se guarda dentro de la configuración global
// activa: `configId` dice en cuál, sin que el caso de uso sepa que es una columna JSONB.
import type { BannerCatalog } from '../../domain/banner-catalog';

export interface StoredBannerCatalog {
  /** La configuración global que lo contiene. */
  configId: string;
  catalog: BannerCatalog;
}

export interface BannerCatalogRepository {
  /** El catálogo de la configuración activa, o null si no hay configuración activa. */
  findActive(): Promise<StoredBannerCatalog | null>;

  /** Reemplaza el catálogo (y sube la versión de la configuración). null si `configId` ya no existe. */
  replace(configId: string, catalog: BannerCatalog): Promise<BannerCatalog | null>;
}
