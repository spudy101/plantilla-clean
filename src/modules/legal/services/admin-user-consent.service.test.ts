// tests/unit/modules/admin/records/legal/services/admin-user-consent.service.test.ts
//
// AdminUserConsentService — consulta administrativa de consentimientos. Probamos la orquestación:
// list() pasa los filtros de la query validada (AdminUserConsentListQuery), pagina y mapea con metadata; getHistoryByUser()
// lanza 404 cuando el usuario no tiene consentimientos y, si los tiene, mapea + audita. Repositorio,
// paginación, DTOs y logger se mockean para aislar la lógica. AppError es el real (verificado con
// .rejects / statusCode).

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../repositories/user-consent.repository', () => ({
  findAllPaginatedForAdmin: jest.fn(),
  findHistoryByUser: jest.fn()
}));

jest.mock('../responses/admin-user-consent.response', () => ({
  UserConsentAuditItemDTO: jest.fn(r => ({ dto: true, ...r }))
}));

import { mocked } from 'tests/helpers/mock';
import consentRepoModule from '../repositories/user-consent.repository';
const consentRepo = mocked(consentRepoModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './admin-user-consent.service';
import { AdminUserConsentListQuery, ConsentHistoryQuery } from '../requests/legal.request';

const PAGE = { page: 1, limit: 10, offset: 0, sortBy: 'grantedAt', order: 'DESC' };

const ADMIN = 'admin-1';

describe('AdminUserConsentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('arma filtros desde el query, pagina, mapea y audita', async () => {
      consentRepo.findAllPaginatedForAdmin.mockResolvedValue({
        rows: [{ user_consent_id: 'c-1' }, { user_consent_id: 'c-2' }],
        count: 2
      });

      const query = AdminUserConsentListQuery.parse({
        userId: '11111111-1111-4111-8111-111111111111',
        consentTypeCode: 'privacy_policy',
        isCurrent: '1',
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01'
      });
      const result = await service.list(query, ADMIN);

      // El esquema ya convirtió cada campo (isCurrent → boolean, fechas → Date, código en mayúsculas)
      const filters = {
        userId: '11111111-1111-4111-8111-111111111111',
        consentTypeCode: 'PRIVACY_POLICY',
        isCurrent: true,
        dateFrom: new Date('2026-01-01'),
        dateTo: new Date('2026-02-01')
      };
      expect(consentRepo.findAllPaginatedForAdmin).toHaveBeenCalledWith(filters, PAGE);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({ dto: true, user_consent_id: 'c-1' });
      expect(result.metadata).toMatchObject({ pagination: { totalItems: 2, currentPage: 1 }, sort: { field: 'grantedAt', order: 'DESC' }, filters });
      expect(logAudit).toHaveBeenCalledWith('CONSENT_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN, details: expect.objectContaining({ totalItems: 2, filters: expect.arrayContaining(['userId', 'consentTypeCode']) }), entityType: 'UserConsent' })
      );
    });

    it('sin filtros no informa metadata.filters', async () => {
      consentRepo.findAllPaginatedForAdmin.mockResolvedValue({ rows: [], count: 0 });

      const result = await service.list(AdminUserConsentListQuery.parse({}), ADMIN);

      expect(result.metadata.filters).toBeUndefined();
      expect(logAudit).toHaveBeenCalledWith('CONSENT_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN, details: { totalItems: 0, filters: [] } })
      );
    });

    it('interpreta isCurrent="false" como boolean false', async () => {
      consentRepo.findAllPaginatedForAdmin.mockResolvedValue({ rows: [], count: 0 });

      await service.list(AdminUserConsentListQuery.parse({ isCurrent: 'false' }), ADMIN);

      expect(consentRepo.findAllPaginatedForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ isCurrent: false }),
        expect.anything()
      );
    });
  });

  describe('getHistoryByUser', () => {
    it('lanza 404 cuando el usuario no tiene consentimientos', async () => {
      consentRepo.findHistoryByUser.mockResolvedValue({ rows: [], count: 0 });

      await expect(service.getHistoryByUser('u-9', ConsentHistoryQuery.parse({}), ADMIN)).rejects.toMatchObject({ statusCode: 404 });
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('mapea el historial, arma metadata y audita', async () => {
      consentRepo.findHistoryByUser.mockResolvedValue({
        rows: [{ user_consent_id: 'c-1' }],
        count: 1
      });

      const result = await service.getHistoryByUser('u-9', ConsentHistoryQuery.parse({}), ADMIN);

      expect(consentRepo.findHistoryByUser).toHaveBeenCalledWith('u-9', PAGE);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ dto: true, user_consent_id: 'c-1' });
      expect(result.metadata.pagination.totalItems).toBe(1);
      expect(logAudit).toHaveBeenCalledWith('CONSENT_HISTORY_VIEWED', expect.objectContaining({ actorId: ADMIN, details: { targetUserId: 'u-9' }, entityId: 'u-9', entityType: 'UserConsent' })
      );
    });
  });
});
