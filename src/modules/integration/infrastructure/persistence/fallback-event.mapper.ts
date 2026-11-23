// Mapper fila de provider_fallback_events ↔ entidad FallbackEvent.
import type { ProviderFallbackEvent as FallbackEventRow } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { FallbackEvent } from '../../domain/fallback-event';

export const FallbackEventMapper = {
  toDomain(row: FallbackEventRow): FallbackEvent {
    return FallbackEvent.restore({
      fallbackEventId: row.providerFallbackEventId,
      provider: row.provider,
      circuitProduct: row.circuitProduct,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      affectedProcessesCount: row.affectedProcessesCount
    });
  }
};
