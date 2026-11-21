import userChangeLogRepository from '../repositories/change-log.repository';
import adminChangeLogDtoModule from '../responses/admin-change-log.response';
const { ListUserChangeLogsResponseDTO } = adminChangeLogDtoModule;
import audit from '../audit.service';
import { pageMetadata, pageRequest } from '../../../shared/application/pagination';
import type { ChangeLogListQuery } from '../requests/audit.request';

type ChangeLogFilters = Parameters<(typeof userChangeLogRepository)['findAllPaginated']>[0];

class ChangeLogService {
  userChangeLogRepository: typeof userChangeLogRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new ChangeLogService({ userChangeLogRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: ChangeLogService.Deps = {}) {
    this.userChangeLogRepository = deps.userChangeLogRepository ?? userChangeLogRepository;
  }

  async listUserChangeLogs(query: ChangeLogListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = {
      userId: query.userId ?? undefined,
      changeType: query.changeType ?? undefined,
      changedByRole: query.changedByRole ?? undefined,
      dateFrom: query.dateFrom ?? undefined,
      dateTo: query.dateTo ?? undefined
    } as ChangeLogFilters;

    const { rows, count } = await this.userChangeLogRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('CHANGE_LOG_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, page: page.page, ...(query.userId ? { targetUserId: query.userId } : {}) },
      entityId: query.userId ?? null,
      entityType: 'AuditRecord'
    });

    return ListUserChangeLogsResponseDTO(rows, pageMetadata(page, count, { search: query.search, ...filters }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ChangeLogService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userChangeLogRepository?: typeof userChangeLogRepository;
  }
}

export default Object.assign(new ChangeLogService(), { ChangeLogService });
