import type { StoredBanner } from '../responses/admin-promotional-banner.response';
import settingsModule from '../../settings';
const { systemGlobalConfigRepository } = settingsModule;
import { toPublicBannerList } from '../responses/promotional-banner.response';
import auditModule from '../../audit';
const { audit } = auditModule;

// Caché en memoria (TTL 60s, patrón del resolver de resiliencia): endpoint público sin auth, no
// puede pegarle a BD en cada request. Un cambio del admin se refleja a lo sumo 60s después.
const CACHE_TTL_MS = 60000;
let cache: { data: ReturnType<typeof toPublicBannerList> | null; expiresAt: number } = { data: null, expiresAt: 0 };

class PromotionalBannerPublicService {
  systemGlobalConfigRepository: typeof systemGlobalConfigRepository;

  /**
   * @param {object} [deps]
   * @param {object} [deps.systemGlobalConfigRepository]
   */
  constructor(deps: PromotionalBannerPublicService.Deps = {}) {
    this.systemGlobalConfigRepository = deps.systemGlobalConfigRepository ?? systemGlobalConfigRepository;
  }

  /**
   * Banners activos para el front (landing pública + app cliente), ordenados por sortOrder.
   * Solo contenido publicado: los banners con is_active false nunca salen de acá.
   */
  async getActiveBanners() {
    if (cache.data && Date.now() < cache.expiresAt) {
      return cache.data;
    }

    const config = await this.systemGlobalConfigRepository.findActive();
    // JSONB: forma libre en el modelo; la describe el DTO
    const banners = (config?.promotionalBanners ?? []) as unknown as StoredBanner[];
    const activos = banners.filter(b => b.is_active !== false);

    const dto = toPublicBannerList(activos);
    cache = { data: dto, expiresAt: Date.now() + CACHE_TTL_MS };

    await audit.record('PROMOTIONAL_BANNERS_PUBLIC_VIEWED', {
      actorId: null,
      details: { total: dto.banners.length },
      entityType: 'SystemGlobalConfig',
      entityTable: 'system_global_config'
    });

    return dto;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PromotionalBannerPublicService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    systemGlobalConfigRepository?: typeof systemGlobalConfigRepository;
  }
}

export default Object.assign(new PromotionalBannerPublicService(), { PromotionalBannerPublicService });
