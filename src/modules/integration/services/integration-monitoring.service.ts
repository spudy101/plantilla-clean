// Monitoreo de los proveedores externos (solo lectura): estado del circuit breaker de cada uno y el
// historial de caídas (provider_fallback_events). Las métricas de cada llamada (% de éxito, latencia,
// fallos) van a CloudWatch: callProvider las emite en cada llamada (EMF).

import CircuitBreaker from '../../../shared/infra/circuit-breaker.util';
import { PROVIDER_PRODUCTS } from '../../../shared/infra/provider-call.util';
import providerFallbackRepository from '../repositories/provider-fallback-event.repository';
import integrationMonitoringDtoModule from '../responses/integration-monitoring.response';
import auditModule from '../../audit';
import { pageOf, pageRequest } from '../../../shared/http/pagination';
import type { FallbackQuery } from '../requests/integration-monitoring.request';
const { audit } = auditModule;
const { ProvidersHealthDTO, FallbackEventDTO } = integrationMonitoringDtoModule;

const FALLBACK_ENTITY = { entityType: 'ProviderFallbackEvent', entityTable: 'provider_fallback_events' };

class IntegrationMonitoringService {
  providerFallbackRepository: typeof providerFallbackRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new IntegrationMonitoringService({ providerFallbackRepository: fake })
   */
  constructor(deps: IntegrationMonitoringService.Deps = {}) {
    this.providerFallbackRepository = deps.providerFallbackRepository ?? providerFallbackRepository;
  }

  /** Semáforo en vivo: estado del circuito de cada proveedor y cuántas caídas siguen abiertas. */
  async getProvidersHealth(adminUserId: string) {
    const [circuits, activeFallbacks] = await Promise.all([
      Promise.all(PROVIDER_PRODUCTS.map(p => CircuitBreaker.getStatus(p))),
      this.providerFallbackRepository.countActive()
    ]);

    await audit.record('PROVIDER_HEALTH_DASHBOARD_VIEWED', {
      actorId: adminUserId,
      details: { activeFallbacks },
      ...FALLBACK_ENTITY
    });

    return ProvidersHealthDTO({ circuits, activeFallbacks, generatedAt: new Date().toISOString() });
  }

  /**
   * Historial paginado de eventos de fallback (ventanas de caída con duración).
   */
  async getFallbackHistory(query: FallbackQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = {
      provider: query.provider || null,
      activeOnly: query.activeOnly === true,
      from: query.from ?? null,
      to: query.to ?? null
    };

    const { rows, count } = await this.providerFallbackRepository.findAllPaginated(filters, page);

    await audit.record('PROVIDER_FALLBACK_HISTORY_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count },
      ...FALLBACK_ENTITY
    });

    return pageOf(rows.map(FallbackEventDTO), page, count, { ...filters, activeOnly: filters.activeOnly || undefined });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace IntegrationMonitoringService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    providerFallbackRepository?: typeof providerFallbackRepository;
  }
}

export default Object.assign(new IntegrationMonitoringService(), { IntegrationMonitoringService });
