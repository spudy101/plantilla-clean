import type { StoredBanner } from '../responses/admin-promotional-banner.response';
import type { BannerInput } from '../requests/admin-promotional-banner.request';
import { v4 as uuidv4 } from 'uuid';
import type { Prisma } from '../../../shared/database/generated/prisma/client';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import S3Util from '../../../shared/infra/s3.util';
import settingsModule from '../../settings';
const { systemGlobalConfigRepository } = settingsModule;
import { toAdminBannerList, toBannerImage } from '../responses/admin-promotional-banner.response';
import auditModule from '../../audit';
const { audit } = auditModule;

// Prefijo del bucket PÚBLICO (CloudFront). Cada imagen sube con key única (uuid), así que no hay
// caché vieja que invalidar: la URL nueva se referencia desde el JSON del banner.
const IMAGE_S3_PREFIX = 'promotional/banners';

const ENTITY_META = { entityType: 'SystemGlobalConfig', entityTable: 'system_global_config' };

class PromotionalBannerService {
  systemGlobalConfigRepository: typeof systemGlobalConfigRepository;
  fileStorage: typeof S3Util;

  /**
   * Dependencias inyectables (SOLID: D).
   * @param {object} [deps]
   * @param {object} [deps.systemGlobalConfigRepository] - acceso a la config global
   * @param {object} [deps.fileStorage] - almacenamiento de archivos (por defecto S3)
   */
  constructor(deps: PromotionalBannerService.Deps = {}) {
    this.systemGlobalConfigRepository = deps.systemGlobalConfigRepository ?? systemGlobalConfigRepository;
    this.fileStorage = deps.fileStorage ?? S3Util;
  }

  async list(adminUserId: string) {
    const config = await this._getActiveConfig();

    await audit.record('PROMOTIONAL_BANNERS_VIEWED_ADMIN', {
      actorId: adminUserId,
      entityId: config.systemGlobalConfigId,
      ...ENTITY_META
    });

    return toAdminBannerList((config.promotionalBanners ?? []) as unknown as StoredBanner[]);
  }

  /**
   * Reemplaza el catálogo completo de banners (PUT): el panel admin manda el array final. Los ids
   * se conservan si vienen y se generan si no. Persistencia snake_case (convención JSONB) — la
   * conversión de/hacia camelCase vive acá y en el DTO, nunca se asigna el JSONB crudo.
   */
  async replace(banners: BannerInput[], adminUserId: string) {
    const config = await this._getActiveConfig();
    // JSONB: forma libre en el modelo; la describe el DTO
    const previousBanners = (config.promotionalBanners ?? []) as unknown as StoredBanner[];

    const normalized = banners.map((b, index): StoredBanner => ({
      id: b.id ?? uuidv4(),
      title: b.title,
      text: b.text,
      tag: b.tag ?? null,
      button_route: b.buttonRoute ?? null,
      button_name: b.buttonName ?? null,
      image_url: b.imageUrl ?? null,
      is_active: b.isActive ?? true,
      sort_order: b.sortOrder ?? index + 1
    }));

    const updated = await this.systemGlobalConfigRepository.update(config.systemGlobalConfigId, {
      promotionalBanners: normalized as unknown as Prisma.InputJsonValue,
      configVersion: { increment: 1 }
    });
    if (!updated) {
      throw AppError.notFound('Configuración global no encontrada');
    }

    // El catálogo ya se persistió: recién ahí borramos de S3 las imágenes que ningún banner
    // referencia más (best-effort — un fallo de S3 no revierte el reemplazo).
    const cleanup = await this._cleanupOrphanImages(previousBanners, normalized);

    await audit.record('PROMOTIONAL_BANNERS_UPDATED', {
      actorId: adminUserId,
      details: { total: normalized.length, active: normalized.filter(b => b.is_active).length, imagesRemoved: cleanup.deleted },
      entityId: config.systemGlobalConfigId,
      ...ENTITY_META
    });

    return toAdminBannerList((updated.promotionalBanners ?? []) as unknown as StoredBanner[]);
  }

  /**
   * Sube la imagen de un banner al bucket PÚBLICO (URL CloudFront estable y cacheable — contenido
   * público, no aplica presignar). Devuelve la URL para referenciarla en el PUT del catálogo.
   */
  async uploadImage(file: Pick<Express.Multer.File, 'buffer' | 'mimetype'> | null | undefined, adminUserId: string) {
    if (!file?.buffer) {
      throw AppError.badRequest('La imagen del banner es requerida (campo multipart "image")');
    }

    const extension = (file.mimetype?.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
    const s3Key = `${IMAGE_S3_PREFIX}/${uuidv4()}.${extension}`;

    const imageUrl = await this.fileStorage.uploadPublicDocument(file.buffer, s3Key, file.mimetype);

    await audit.record('PROMOTIONAL_BANNER_IMAGE_UPLOADED', {
      actorId: adminUserId,
      details: { s3Key },
      ...ENTITY_META
    });

    return toBannerImage(imageUrl, s3Key);
  }

  /**
   * Borra del bucket PÚBLICO las imágenes que dejaron de estar referenciadas por algún banner
   * (huérfanas tras el reemplazo del catálogo). Solo toca las que subió este mantenedor (viven
   * bajo IMAGE_S3_PREFIX); URLs externas (assets de marca, etc.) se ignoran. Best-effort: nunca
   * lanza — el catálogo ya quedó persistido y una imagen huérfana no debe romper el PUT.
   * @private
   */
  async _cleanupOrphanImages(previous: readonly StoredBanner[] | null | undefined, next: readonly StoredBanner[]) {
    const keptUrls = new Set(next.map(b => b.image_url).filter(Boolean));
    const orphanKeys = [
      ...new Set(
        (Array.isArray(previous) ? previous : [])
          .map(b => b?.image_url)
          .filter((url): url is string => Boolean(url) && !keptUrls.has(url))
          .map(url => this._managedImageKey(url))
          .filter((key): key is string => key !== null)
      )
    ];

    if (!orphanKeys.length) {
      return { deleted: 0, orphanKeys: [] };
    }

    const results = await Promise.allSettled(orphanKeys.map(key => this.fileStorage.deletePublicFile(key)));
    const deleted = results.filter(r => r.status === 'fulfilled').length;

    if (deleted < orphanKeys.length) {
      logger.warn('Limpieza de imágenes de banner: algunas imágenes huérfanas no se pudieron borrar', {
        orphanKeys,
        deleted,
        failed: orphanKeys.length - deleted
      });
    }

    return { deleted, orphanKeys };
  }

  /**
   * S3 key de una imagen SOLO si vive bajo el prefijo gestionado por este mantenedor (las que
   * suben por uploadImage). URLs externas (marca, terceros) o malformadas → null: no se borran.
   * @private
   */
  _managedImageKey(imageUrl: string): string | null {
    try {
      const key = new URL(imageUrl).pathname.replace(/^\/+/, '');
      return key.startsWith(`${IMAGE_S3_PREFIX}/`) ? key : null;
    } catch {
      return null;
    }
  }

  /** @private */
  async _getActiveConfig() {
    const config = await this.systemGlobalConfigRepository.findActive();
    if (!config) {
      throw AppError.notFound('No hay una configuración global activa. Contacta al equipo de infraestructura.');
    }
    return config;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PromotionalBannerService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    systemGlobalConfigRepository?: typeof systemGlobalConfigRepository;
    fileStorage?: typeof S3Util;
  }
}

export default Object.assign(new PromotionalBannerService(), { PromotionalBannerService });
