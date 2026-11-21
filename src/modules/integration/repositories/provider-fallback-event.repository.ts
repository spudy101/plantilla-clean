// modules/schemas/integration/repositories/provider-fallback-event.repository.ts
//
// Ventanas de caída de un proveedor (circuito abierto → cerrado) para el monitoreo de integraciones.
import PrismaRepository from '../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../shared/application/pagination';
import type { Prisma, ProviderFallbackEvent } from '../../../shared/infrastructure/database/generated/prisma/client';

// Tolerancia al emparejar el cierre con su apertura (relojes de distintos procesos)
const MATCH_WINDOW_MS = 5000;

class ProviderFallbackEventRepository extends PrismaRepository {
  async openFallback({
    provider,
    circuitProduct,
    startedAt,
    metadata = null
  }: {
    provider: string;
    circuitProduct: string;
    startedAt: Date;
    metadata?: unknown;
  }): Promise<ProviderFallbackEvent> {
    return (await this.db()).providerFallbackEvent.create({
      data: {
        provider,
        circuitProduct,
        startedAt,
        endedAt: null,
        ...(metadata != null ? { metadata: metadata as Prisma.InputJsonValue } : {})
      }
    });
  }

  /** Cierra la ventana abierta más reciente del proveedor (desde `startedAt` − tolerancia). Null si no hay. */
  closeFallback({
    provider,
    startedAt,
    endedAt,
    affectedCount
  }: {
    provider: string;
    startedAt?: Date | number | null;
    endedAt: Date;
    affectedCount: number | null;
  }): Promise<ProviderFallbackEvent | null> {
    return this.atomic(async db => {
      const event = await db.providerFallbackEvent.findFirst({
        where: {
          provider,
          endedAt: null,
          ...(startedAt ? { startedAt: { gte: new Date(Number(startedAt) - MATCH_WINDOW_MS) } } : {})
        },
        orderBy: { startedAt: 'desc' }
      });
      if (!event) {
        return null;
      }
      return db.providerFallbackEvent.update({
        where: { providerFallbackEventId: event.providerFallbackEventId },
        data: { endedAt, affectedProcessesCount: affectedCount }
      });
    });
  }

  async countActive(): Promise<number> {
    return (await this.db()).providerFallbackEvent.count({ where: { endedAt: null } });
  }

  async findAllPaginated(
    {
      provider = null,
      activeOnly = false,
      from = null,
      to = null
    }: { provider?: string | null; activeOnly?: boolean; from?: string | Date | null; to?: string | Date | null } = {},
    page: PageRequest
  ): Promise<PrismaRepository.Page<ProviderFallbackEvent>> {
    const where: Prisma.ProviderFallbackEventWhereInput = {};
    if (provider) {
      where.provider = provider;
    }
    if (activeOnly) {
      where.endedAt = null;
    }
    if (from || to) {
      where.startedAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    }
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.providerFallbackEvent.findMany({ where, ...this.paginationArgs(page, 'providerFallbackEventId') }),
      db.providerFallbackEvent.count({ where })
    ]);
    return { rows, count };
  }
}

export default new ProviderFallbackEventRepository();
