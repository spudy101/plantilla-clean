// Caso de uso: el administrador reemplaza el catálogo completo de banners (PUT).
//
// Flujo: lee el catálogo actual → el dominio arma el nuevo (ids, valores por defecto) → se guarda → recién
// entonces se borran las imágenes que quedaron huérfanas (un fallo ahí no revierte el reemplazo) → auditoría.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { IdGenerator } from '../../../../shared/application/ports/id-generator.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { BannerCatalogRepository } from '../ports/banner-catalog-repository.port';
import type { BannerImageStorage } from '../ports/banner-image-storage.port';
import { BannerCatalog, type BannerDraft } from '../../domain/banner-catalog';
import { BannerCatalogNotFoundError, BannerCatalogVanishedError } from '../../domain/errors';
import { toAdminBannerList, type AdminBannerListOutput } from '../dto/banner.output';
import { BANNER_AUDIT_ENTITY } from './banner-audit';

export interface ReplaceBannersInput {
  actorId: string;
  banners: BannerDraft[];
}

export class ReplaceBanners {
  constructor(
    private readonly catalogs: BannerCatalogRepository,
    private readonly images: BannerImageStorage,
    private readonly ids: IdGenerator,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ actorId, banners }: ReplaceBannersInput): Promise<AdminBannerListOutput> {
    const stored = await this.catalogs.findActive();
    if (!stored) {
      throw new BannerCatalogNotFoundError();
    }

    const next = BannerCatalog.fromDrafts(banners, () => this.ids.next());
    const saved = await this.catalogs.replace(stored.configId, next);
    if (!saved) {
      throw new BannerCatalogVanishedError();
    }

    const imagesRemoved = await this.removeOrphanImages(stored.catalog, next);

    await this.audit.record('PROMOTIONAL_BANNERS_UPDATED', {
      actorId,
      details: { total: next.size, active: next.activeCount, imagesRemoved },
      entityId: stored.configId,
      ...BANNER_AUDIT_ENTITY
    });

    return toAdminBannerList(saved);
  }

  /** Best-effort: el catálogo ya quedó guardado, una imagen que no se pudo borrar solo se loguea. */
  private async removeOrphanImages(previous: BannerCatalog, next: BannerCatalog): Promise<number> {
    const orphans = previous.imagesOrphanedBy(next);
    if (orphans.length === 0) {
      return 0;
    }
    const { attempted, deleted } = await this.images.removeUnused(orphans);
    if (deleted < attempted.length) {
      this.logger.warn('Limpieza de imágenes de banner: algunas imágenes huérfanas no se pudieron borrar', {
        orphanKeys: attempted,
        deleted,
        failed: attempted.length - deleted
      });
    }
    return deleted;
  }
}
