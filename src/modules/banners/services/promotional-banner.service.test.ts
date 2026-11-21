import { interopDefault } from '../../../shared/kernel/interop.util';
import { Loose } from 'tests/helpers/mock';
// tests/unit/modules/shared-endpoints/core/services/promotional-banner.service.test.ts
//
// PromotionalBannerPublicService — banners activos para el front público. El servicio mantiene una
// caché en memoria (TTL 60s) a nivel de módulo, así que aislamos cada test con jest.resetModules()
// para partir siempre con la caché vacía. Probamos: (1) cache miss → pega a BD, filtra inactivos,
// arma DTO, audita y cachea; (2) cache hit → segunda llamada NO vuelve a BD; (3) config nula →
// lista vacía sin reventar.

jest.mock('../../settings/infrastructure/persistence/legacy-system-global-config.repository', () => ({ findActive: jest.fn() }));
jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({ logAudit: jest.fn() }));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));
jest.mock('../responses/promotional-banner.response', () => ({
  toPublicBannerList: jest.fn()
}));

describe('PromotionalBannerPublicService', () => {
  let systemGlobalConfigRepository: Loose;
  let logAudit: Loose;
  let toPublicBannerList: Loose;
  let service: Loose;

  beforeEach(() => {
    // Caché en memoria a nivel de módulo → reset para cada test.
    jest.resetModules();
    systemGlobalConfigRepository = interopDefault(require('../../settings/infrastructure/persistence/legacy-system-global-config.repository') as typeof import('../../settings/infrastructure/persistence/legacy-system-global-config.repository'));
    logAudit = interopDefault(require('../../audit/audit.service') as typeof import('../../audit/audit.service')).record;
    ({ toPublicBannerList } = (require('../responses/promotional-banner.response') as typeof import('../responses/promotional-banner.response')));
    service = interopDefault(require('./promotional-banner.service') as typeof import('./promotional-banner.service'));
  });

  describe('getActiveBanners — cache miss', () => {
    it('lee la config activa, descarta banners is_active=false, arma DTO, audita y cachea', async () => {
      const banners = [
        { id: 1, title: 'A', is_active: true },
        { id: 2, title: 'B', is_active: false },
        { id: 3, title: 'C' } // sin flag => se considera activo
      ];
      systemGlobalConfigRepository.findActive.mockResolvedValue({ promotionalBanners: banners });
      const dto = { banners: [{ id: 1 }, { id: 3 }] };
      toPublicBannerList.mockReturnValue(dto);

      const result = await service.getActiveBanners();

      expect(systemGlobalConfigRepository.findActive).toHaveBeenCalled();
      // Solo llegan al DTO los que NO tienen is_active === false.
      expect(toPublicBannerList).toHaveBeenCalledWith([
        { id: 1, title: 'A', is_active: true },
        { id: 3, title: 'C' }
      ]);
      expect(logAudit).toHaveBeenCalledWith('PROMOTIONAL_BANNERS_PUBLIC_VIEWED', { actorId: null, details: { total: 2 }, entityType: 'SystemGlobalConfig', entityTable: 'system_global_config' }
      );
      expect(result).toBe(dto);
    });

    it('sin config activa devuelve DTO con lista vacía sin lanzar', async () => {
      systemGlobalConfigRepository.findActive.mockResolvedValue(null);
      const dto = { banners: [] };
      toPublicBannerList.mockReturnValue(dto);

      const result = await service.getActiveBanners();

      expect(toPublicBannerList).toHaveBeenCalledWith([]);
      expect(result).toBe(dto);
    });
  });

  describe('getActiveBanners — cache hit', () => {
    it('la segunda llamada usa la caché y NO vuelve a pegarle a BD', async () => {
      systemGlobalConfigRepository.findActive.mockResolvedValue({ promotionalBanners: [] });
      const dto = { banners: [] };
      toPublicBannerList.mockReturnValue(dto);

      const first = await service.getActiveBanners();
      const second = await service.getActiveBanners();

      expect(systemGlobalConfigRepository.findActive).toHaveBeenCalledTimes(1);
      expect(toPublicBannerList).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });
});
