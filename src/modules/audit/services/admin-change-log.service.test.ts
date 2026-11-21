// tests/unit/modules/admin/records/audit/services/admin-change-log.service.test.ts
//
// ChangeLogService — listado paginado del historial de cambios de usuario para el panel admin.
// Orquesta paginación + filtros, consulta el repositorio, audita la consulta (CHANGE_LOG_VIEWED) y
// arma la respuesta vía DTO. Probamos: (1) camino base sin filtros opcionales; (2) camino con
// userId/dateFrom/dateTo/search, verificando que se inyectan en filters/metadata y que la auditoría
// incluye targetUserId. Repos, paginación, logger y DTO se mockean para aislar la lógica.

jest.mock('../repositories/change-log.repository', () => ({
  findAllPaginated: jest.fn()
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../audit.service', () => ({ record: jest.fn() }));

jest.mock('../responses/admin-change-log.response', () => ({
  ListUserChangeLogsResponseDTO: jest.fn((rows, metadata) => ({ data: rows, metadata }))
}));

import { mocked } from 'tests/helpers/mock';
import userChangeLogRepositoryModule from '../repositories/change-log.repository';
const userChangeLogRepository = mocked(userChangeLogRepositoryModule);
import auditServiceModule from '../audit.service';
const logAudit = mocked(auditServiceModule).record;
import adminChangeLogDtoModule from '../responses/admin-change-log.response';
const { ListUserChangeLogsResponseDTO } = mocked(adminChangeLogDtoModule);
import service from './admin-change-log.service';
import { ChangeLogListQuery } from '../requests/audit.request';

const ADMIN = 'admin-1';
const PAGINATION = { page: 2, limit: 20, offset: 20, sortBy: 'createdAt', order: 'DESC' };
const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('ChangeLogService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userChangeLogRepository.findAllPaginated.mockResolvedValue({ rows: [{ id: 'c1' }], count: 1 });
  });

  describe('listUserChangeLogs', () => {
    it('lista con filtros base (sin userId/fechas/search) y audita sin targetUserId', async () => {
      const result = await service.listUserChangeLogs(ChangeLogListQuery.parse({ page: '2', limit: '20' }), ADMIN);

      expect(userChangeLogRepository.findAllPaginated).toHaveBeenCalledWith({}, PAGINATION, null);

      expect(logAudit).toHaveBeenCalledWith('CHANGE_LOG_VIEWED', { actorId: ADMIN, details: { totalItems: 1, page: 2 }, entityId: null, entityType: 'AuditRecord' }
      );

      expect(ListUserChangeLogsResponseDTO).toHaveBeenCalledWith(
        [{ id: 'c1' }],
        {
          pagination: { currentPage: 2, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: true },
          sort: { field: 'createdAt', order: 'DESC' }
        }
      );
      expect(result.data).toEqual([{ id: 'c1' }]);
    });

    it('pasa userId/changeType/fechas/search al repositorio con el nombre que espera, y audita targetUserId', async () => {
      const query = ChangeLogListQuery.parse({
        page: '2',
        limit: '20',
        userId: USER_ID,
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01',
        search: 'admin',
        changeType: 'password'
      });

      await service.listUserChangeLogs(query, ADMIN);

      // Antes se pasaba como user_id y el repositorio (que lee userId) no filtraba por usuario
      const filters = { userId: USER_ID, changeType: 'password', dateFrom: new Date('2026-01-01'), dateTo: new Date('2026-02-01') };
      expect(userChangeLogRepository.findAllPaginated).toHaveBeenCalledWith(filters, PAGINATION, 'admin');

      expect(logAudit).toHaveBeenCalledWith('CHANGE_LOG_VIEWED', { actorId: ADMIN, details: { totalItems: 1, page: 2, targetUserId: USER_ID }, entityId: USER_ID, entityType: 'AuditRecord' }
      );

      const [, metadata] = ListUserChangeLogsResponseDTO.mock.calls[0];
      expect(metadata.filters).toEqual({ search: 'admin', ...filters });
    });
  });
});
