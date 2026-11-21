import AppError from '../../../shared/http/app-error.util';
import userConsentRepository from '../repositories/user-consent.repository';
import adminUserConsentDtoModule from '../responses/admin-user-consent.response';
const { UserConsentAuditItemDTO } = adminUserConsentDtoModule;
import auditModule from '../../audit';
import { appliedFilters, pageOf, pageRequest } from '../../../shared/http/pagination';
import type { AdminUserConsentListQuery, ConsentHistoryQuery } from '../requests/legal.request';

type ConsentFilters = NonNullable<Parameters<(typeof userConsentRepository)['findAllPaginatedForAdmin']>[0]>;
const { audit } = auditModule;

class AdminUserConsentService {
  userConsentRepository: typeof userConsentRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AdminUserConsentService({ userConsentRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: AdminUserConsentService.Deps = {}) {
    this.userConsentRepository = deps.userConsentRepository ?? userConsentRepository;
  }

  async list(query: AdminUserConsentListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters = appliedFilters({
      userId: query.userId,
      consentTypeCode: query.consentTypeCode,
      isCurrent: query.isCurrent,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    }) as ConsentFilters;

    const { rows, count } = await this.userConsentRepository.findAllPaginatedForAdmin(filters, page);

    await audit.record('CONSENT_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, filters: Object.keys(filters) },
      entityType: 'UserConsent',
      entityTable: 'user_consents'
    });

    return pageOf(
      rows.map(r => UserConsentAuditItemDTO(r)),
      page,
      count,
      filters
    );
  }

  async getHistoryByUser(userId: string, query: ConsentHistoryQuery, adminUserId: string) {
    const page = pageRequest(query);

    const { rows, count } = await this.userConsentRepository.findHistoryByUser(userId, page);

    if (count === 0) {
      throw AppError.notFound('No se encontraron consentimientos para este usuario');
    }

    await audit.record('CONSENT_HISTORY_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      entityType: 'UserConsent',
      entityTable: 'user_consents'
    });

    return pageOf(
      rows.map(r => UserConsentAuditItemDTO(r)),
      page,
      count
    );
  }
}



// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminUserConsentService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userConsentRepository?: typeof userConsentRepository;
  }
}

export default Object.assign(new AdminUserConsentService(), { AdminUserConsentService });
