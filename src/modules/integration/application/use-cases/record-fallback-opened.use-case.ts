// Caso de uso: el circuito de un proveedor se abrió → empieza una ventana de fallback y se audita.
// Lo dispara el circuit breaker (infrastructure/circuit-breaker/fallback-circuit.listener.ts).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { FallbackEventRepository } from '../ports/fallback-event-repository.port';
import { providerNameFor } from '../../domain/fallback-event';

export class RecordFallbackOpened {
  constructor(
    private readonly fallbacks: FallbackEventRepository,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ product, openedAt }: { product: string; openedAt: Date }): Promise<void> {
    const provider = providerNameFor(product);
    await this.fallbacks.open({ provider, circuitProduct: product, startedAt: openedAt });
    await this.audit.record('PROVIDER_FALLBACK_ACTIVATED', {
      actorId: null,
      details: { provider, product, openedAt: openedAt.toISOString() }
    });
    this.logger.warn(`[ProviderFallback] Fallback activado para ${product}`);
  }
}
