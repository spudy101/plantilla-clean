// Adaptador del puerto TechnicalDataRetention con los repositorios de shared/infrastructure (operaciones y
// claves de idempotencia; ver docs/idempotency.md).
import operationRepository from '../../../../shared/infrastructure/observability/operation.repository';
import idempotencyRepository from '../../../../shared/infrastructure/database/idempotency.repository';
import type { TechnicalDataRetention } from '../../application/ports/technical-data-retention.port';

export class PrismaTechnicalDataRetention implements TechnicalDataRetention {
  constructor(
    private readonly operations: Pick<typeof operationRepository, 'purgeOlderThan'> = operationRepository,
    private readonly idempotencyKeys: Pick<typeof idempotencyRepository, 'purgeExpired'> = idempotencyRepository
  ) {}

  purgeOperationsBefore(cutoff: Date): Promise<number> {
    return this.operations.purgeOlderThan(cutoff);
  }

  purgeExpiredIdempotencyKeys(): Promise<number> {
    return this.idempotencyKeys.purgeExpired();
  }
}
