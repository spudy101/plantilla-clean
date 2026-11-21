// Caso de uso: el administrador ve el catálogo completo de banners (activos e inactivos).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { BannerCatalogRepository } from '../ports/banner-catalog-repository.port';
import { BannerCatalogNotFoundError } from '../../domain/errors';
import { toAdminBannerList, type AdminBannerListOutput } from '../dto/banner.output';
import { BANNER_AUDIT_ENTITY } from './banner-audit';

export class ListAdminBanners {
  constructor(
    private readonly catalogs: BannerCatalogRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId }: { actorId: string }): Promise<AdminBannerListOutput> {
    const stored = await this.catalogs.findActive();
    if (!stored) {
      throw new BannerCatalogNotFoundError();
    }

    await this.audit.record('PROMOTIONAL_BANNERS_VIEWED_ADMIN', { actorId, entityId: stored.configId, ...BANNER_AUDIT_ENTITY });
    return toAdminBannerList(stored.catalog);
  }
}
