// Caso de uso: el semáforo en vivo de los proveedores externos (estado del circuito de cada uno) y cuántas
// caídas siguen abiertas. Las métricas por llamada (% de éxito, latencia) están en CloudWatch, no acá.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { CircuitStatusReader } from '../ports/circuit-status-reader.port';
import type { FallbackEventRepository } from '../ports/fallback-event-repository.port';
import { toProvidersHealthOutput } from '../dto/integration-monitoring.output';
import { FALLBACK_AUDIT_ENTITY } from './integration-audit';

export class GetProvidersHealth {
  constructor(
    private readonly circuits: CircuitStatusReader,
    private readonly fallbacks: FallbackEventRepository,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId }: { actorId: string }) {
    const [circuits, activeFallbacks] = await Promise.all([this.circuits.readAll(), this.fallbacks.countActive()]);

    await this.audit.record('PROVIDER_HEALTH_DASHBOARD_VIEWED', {
      actorId,
      details: { activeFallbacks },
      ...FALLBACK_AUDIT_ENTITY
    });

    return toProvidersHealthOutput({ circuits, activeFallbacks, generatedAt: new Date() });
  }
}
