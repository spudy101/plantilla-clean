// IntegrationMonitoringService — panel de solo lectura sobre los proveedores externos: semáforo del
// circuit breaker (getProvidersHealth) e historial de caídas (getFallbackHistory). Las métricas por
// llamada están en CloudWatch. Repos, CircuitBreaker y auditoría se mockean; la query pasa por FallbackQuery.

jest.mock('../repositories/provider-fallback-event.repository', () => ({
  countActive: jest.fn(),
  findAllPaginated: jest.fn()
}));

jest.mock('../../../shared/infra/circuit-breaker.util', () => ({
  getStatus: jest.fn()
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

import { mocked } from 'tests/helpers/mock';
import fallbackRepoModule from '../repositories/provider-fallback-event.repository';
const fallbackRepo = mocked(fallbackRepoModule);
import CircuitBreakerModule from '../../../shared/infra/circuit-breaker.util';
const CircuitBreaker = mocked(CircuitBreakerModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import { PROVIDER_PRODUCTS } from '../../../shared/infra/provider-call.util';
import service from './integration-monitoring.service';
import { FallbackQuery } from '../requests/integration-monitoring.request';

const ADMIN = 'admin-1';

describe('IntegrationMonitoringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    CircuitBreaker.getStatus.mockImplementation(product =>
      Promise.resolve({ product, status: product === 's3' ? 'OPEN' : 'CLOSED', failures: 0, openedAt: null, openedAtISO: null })
    );
  });

  describe('getProvidersHealth', () => {
    it('consulta el circuito de cada proveedor, cuenta las caídas abiertas y audita', async () => {
      fallbackRepo.countActive.mockResolvedValue(1);

      const result = await service.getProvidersHealth(ADMIN);

      expect(CircuitBreaker.getStatus).toHaveBeenCalledTimes(PROVIDER_PRODUCTS.length);
      expect(result.providers.map(p => p.product)).toEqual([...PROVIDER_PRODUCTS]);
      expect(result.providers.find(p => p.product === 's3')?.availabilityStatus).toBe('No disponible');
      expect(result.activeFallbacks).toBe(1);
      expect(logAudit).toHaveBeenCalledWith(
        'PROVIDER_HEALTH_DASHBOARD_VIEWED',
        expect.objectContaining({ actorId: ADMIN, details: { activeFallbacks: 1 } })
      );
    });
  });

  describe('getFallbackHistory', () => {
    it('interpreta activeOnly y descarta null/false de los filtros activos', async () => {
      fallbackRepo.findAllPaginated.mockResolvedValue({
        rows: [
          {
            providerFallbackEventId: 'f-1',
            provider: 'aws_sns',
            circuitProduct: 'sns',
            startedAt: new Date(),
            endedAt: null,
            affectedProcessesCount: null
          }
        ],
        count: 1
      } as never);

      // '1' también es verdadero (antes el service solo reconocía el texto 'true')
      const result = await service.getFallbackHistory(FallbackQuery.parse({ provider: 'sns', activeOnly: '1', from: '2026-11-01' }), ADMIN);

      expect(fallbackRepo.findAllPaginated).toHaveBeenCalledWith(
        { provider: 'sns', activeOnly: true, from: new Date('2026-11-01'), to: null },
        expect.objectContaining({ sortBy: 'startedAt', order: 'DESC' })
      );
      expect(result.data[0]).toMatchObject({ fallbackEventId: 'f-1', active: true });
      expect(result.metadata.filters).toEqual({ provider: 'sns', activeOnly: true, from: new Date('2026-11-01') });
      expect(result.metadata.sort).toEqual({ field: 'startedAt', order: 'DESC' });
    });

    it('con activeOnly ausente (false) no lo lista como filtro activo', async () => {
      fallbackRepo.findAllPaginated.mockResolvedValue({ rows: [], count: 0 });

      const result = await service.getFallbackHistory(FallbackQuery.parse({}), ADMIN);

      expect(result.metadata.filters).toBeUndefined();
    });
  });
});
