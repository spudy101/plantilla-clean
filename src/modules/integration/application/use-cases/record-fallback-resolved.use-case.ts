// Caso de uso: el circuito de un proveedor se cerró → termina su ventana de fallback (con duración y
// procesos afectados) y se audita. Lo dispara el circuit breaker (infrastructure/circuit-breaker/).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { FailedProcessCounter } from '../ports/failed-process-counter.port';
import type { FallbackEventRepository } from '../ports/fallback-event-repository.port';
import { durationSeconds, providerNameFor } from '../../domain/fallback-event';

export class RecordFallbackResolved {
  constructor(
    private readonly fallbacks: FallbackEventRepository,
    private readonly failedProcesses: FailedProcessCounter,
    private readonly audit: AuditTrail,
    private readonly logger: Logger
  ) {}

  async execute({ product, openedAt }: { product: string; openedAt: Date }): Promise<void> {
    const provider = providerNameFor(product);
    const endedAt = new Date();
    const affectedCount = await this.countAffected(product, openedAt, endedAt);

    await this.fallbacks.closeLatestOpen({ provider, startedAt: openedAt, endedAt, affectedCount });
    await this.audit.record('PROVIDER_FALLBACK_RESOLVED', {
      actorId: null,
      details: {
        provider,
        product,
        openedAt: openedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds: durationSeconds(openedAt, endedAt),
        affectedCount
      }
    });
    this.logger.info(`[ProviderFallback] Fallback resuelto para ${product}`, { affectedCount });
  }

  // Si la cuenta falla, null: no saber el impacto no frena el cierre de la ventana.
  private async countAffected(product: string, from: Date, to: Date): Promise<number | null> {
    try {
      return await this.failedProcesses.countFailedBetween(product, from, to);
    } catch {
      return null;
    }
  }
}
