// Caso de uso: los banners publicados para la landing y la app cliente (ruta pública, sin sesión).
//
// Se cachea 60 s: es un endpoint público y no puede ir a la base en cada petición. Un cambio del
// administrador se ve a lo sumo 60 s después. Solo se audita cuando se lee de la base.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { KeyValueCache } from '../../../../shared/application/ports/key-value-cache.port';
import type { BannerCatalogRepository } from '../ports/banner-catalog-repository.port';
import { BannerCatalog } from '../../domain/banner-catalog';
import { toPublicBannerList, type PublicBannerListOutput } from '../dto/banner.output';
import { BANNER_AUDIT_ENTITY } from './banner-audit';

export const PUBLIC_BANNERS_CACHE_KEY = 'banners:public';
export const PUBLIC_BANNERS_CACHE_TTL_SECONDS = 60;

export class ListPublicBanners {
  constructor(
    private readonly catalogs: BannerCatalogRepository,
    private readonly cache: KeyValueCache,
    private readonly audit: AuditTrail
  ) {}

  async execute(): Promise<PublicBannerListOutput> {
    const cached = (await this.cache.get(PUBLIC_BANNERS_CACHE_KEY)) as PublicBannerListOutput | null | undefined;
    if (cached) {
      return cached;
    }

    // Sin configuración activa no es un error para el público: simplemente no hay banners
    const stored = await this.catalogs.findActive();
    const output = toPublicBannerList(stored?.catalog ?? BannerCatalog.empty());
    await this.cache.set(PUBLIC_BANNERS_CACHE_KEY, output, PUBLIC_BANNERS_CACHE_TTL_SECONDS);

    await this.audit.record('PROMOTIONAL_BANNERS_PUBLIC_VIEWED', {
      actorId: null,
      details: { total: output.banners.length },
      ...BANNER_AUDIT_ENTITY
    });
    return output;
  }
}
