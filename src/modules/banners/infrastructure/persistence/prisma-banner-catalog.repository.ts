// Adaptador Prisma del puerto BannerCatalogRepository. El catálogo es la columna promotional_banners de la
// configuración global activa: banners es el dueño de esa columna y la lee y escribe acá (las demás columnas
// de la tabla son de settings).
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { BannerCatalogRepository, StoredBannerCatalog } from '../../application/ports/banner-catalog-repository.port';
import type { BannerCatalog } from '../../domain/banner-catalog';
import { BannerMapper } from './banner.mapper';

const COLUMNS = { systemGlobalConfigId: true, promotionalBanners: true } as const satisfies Prisma.SystemGlobalConfigSelect;

export class PrismaBannerCatalogRepository extends PrismaRepository implements BannerCatalogRepository {
  async findActive(): Promise<StoredBannerCatalog | null> {
    const row = await (await this.db()).systemGlobalConfig.findFirst({ where: { isActive: true }, select: COLUMNS });
    return row ? { configId: row.systemGlobalConfigId, catalog: BannerMapper.toDomain(row.promotionalBanners) } : null;
  }

  async replace(configId: string, catalog: BannerCatalog): Promise<BannerCatalog | null> {
    const [row] = await (
      await this.db()
    ).systemGlobalConfig.updateManyAndReturn({
      where: { systemGlobalConfigId: configId },
      // La versión de la configuración sube de forma atómica en la base
      data: {
        promotionalBanners: BannerMapper.toStored(catalog) as unknown as Prisma.InputJsonValue,
        configVersion: { increment: 1 }
      },
      select: COLUMNS
    });
    return row ? BannerMapper.toDomain(row.promotionalBanners) : null;
  }
}
