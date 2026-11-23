// Adaptador Prisma del puerto FallbackEventRepository: ventanas de caída de un proveedor (circuito abierto →
// cerrado) en provider_fallback_events.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import type {
  FallbackClosing,
  FallbackEventPage,
  FallbackEventRepository,
  FallbackHistoryFilters,
  FallbackOpening
} from '../../application/ports/fallback-event-repository.port';
import type { FallbackEvent } from '../../domain/fallback-event';
import { FallbackEventMapper } from './fallback-event.mapper';

const { toDomain } = FallbackEventMapper;

// Tolerancia al emparejar el cierre con su apertura (relojes de distintos procesos)
const MATCH_WINDOW_MS = 5000;

export class PrismaFallbackEventRepository extends PrismaRepository implements FallbackEventRepository {
  async open({ provider, circuitProduct, startedAt }: FallbackOpening): Promise<FallbackEvent> {
    const row = await (await this.db()).providerFallbackEvent.create({
      data: { provider, circuitProduct, startedAt, endedAt: null }
    });
    return toDomain(row);
  }

  closeLatestOpen({ provider, startedAt, endedAt, affectedCount }: FallbackClosing): Promise<FallbackEvent | null> {
    return this.atomic(async db => {
      const event = await db.providerFallbackEvent.findFirst({
        where: {
          provider,
          endedAt: null,
          ...(startedAt ? { startedAt: { gte: new Date(startedAt.getTime() - MATCH_WINDOW_MS) } } : {})
        },
        orderBy: { startedAt: 'desc' }
      });
      if (!event) {
        return null;
      }
      const row = await db.providerFallbackEvent.update({
        where: { providerFallbackEventId: event.providerFallbackEventId },
        data: { endedAt, affectedProcessesCount: affectedCount }
      });
      return toDomain(row);
    });
  }

  async countActive(): Promise<number> {
    return (await this.db()).providerFallbackEvent.count({ where: { endedAt: null } });
  }

  async list({ provider, activeOnly, from, to }: FallbackHistoryFilters, page: PageRequest): Promise<FallbackEventPage> {
    const where: Prisma.ProviderFallbackEventWhereInput = {};
    if (provider) {
      where.provider = provider;
    }
    if (activeOnly) {
      where.endedAt = null;
    }
    if (from || to) {
      where.startedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.providerFallbackEvent.findMany({ where, ...this.paginationArgs(page, 'providerFallbackEventId') }),
      db.providerFallbackEvent.count({ where })
    ]);
    return { rows: rows.map(toDomain), count };
  }
}
