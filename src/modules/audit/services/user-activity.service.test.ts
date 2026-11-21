// tests/unit/modules/client/records/audit/services/user-activity.service.test.ts
//
// UserActivityService — feed de actividad del propio usuario, mezcla de audit_logs (self) + user_change_logs
// (cambios de terceros). Probamos: fusión y orden descendente por fecha con corte de página, resolución por
// lote del dispositivo por sesión (solo sesiones del propio usuario), y el corto-circuito cuando no hay
// session_ids. Repos y DTO mockeados; la paginación real se ejercita.

jest.mock('../repositories/audit-log.repository', () => ({
  findClientSafeByUser: jest.fn()
}));

jest.mock('../repositories/change-log.repository', () => ({
  findExternalChangesByUserId: jest.fn()
}));

jest.mock('../../iam/repositories/user-session.repository', () => ({
  findByIdsWithDeviceForUser: jest.fn()
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../audit.service', () => ({ record: jest.fn() }));

jest.mock('../responses/user-activity.response', () => ({
  UserActivityListResponseDTO: jest.fn((merged, metadata, deviceBySession) => ({ merged, metadata, deviceBySession }))
}));

import { mocked, Loose } from 'tests/helpers/mock';
import auditLogRepositoryModule from '../repositories/audit-log.repository';
const auditLogRepository = mocked(auditLogRepositoryModule);
import userChangeLogRepositoryModule from '../repositories/change-log.repository';
const userChangeLogRepository = mocked(userChangeLogRepositoryModule);
import userSessionRepositoryModule from '../../iam/repositories/user-session.repository';
const userSessionRepository = mocked(userSessionRepositoryModule);
import auditServiceModule from '../audit.service';
const logAudit = mocked(auditServiceModule).record;
import userActivityDtoModule from '../responses/user-activity.response';
const { UserActivityListResponseDTO } = mocked(userActivityDtoModule);
import service from './user-activity.service';
import { RecentActivityQuery } from '../requests/audit.request';

const USER_ID = 'user-1';

describe('UserActivityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRecentActivity', () => {
    it('fusiona ambas fuentes, ordena por fecha desc, audita y resuelve dispositivos por sesión', async () => {
      auditLogRepository.findClientSafeByUser.mockResolvedValue({
        rows: [{ auditLogId: 'a1', sessionId: 'sess1', createdAt: new Date('2026-01-02') }],
        count: 1
      });
      userChangeLogRepository.findExternalChangesByUserId.mockResolvedValue({
        rows: [{ logId: 'c1', originSessionId: 'sess2', createdAt: new Date('2026-01-03') }],
        count: 1
      });
      userSessionRepository.findByIdsWithDeviceForUser.mockResolvedValue([
        { userSessionId: 'sess1', device: { userTrustedDeviceId: 'd1', deviceName: 'iPhone' } },
        { userSessionId: 'sess2', device: null }
      ]);

      // UserActivityListResponseDTO está mockeado: el resultado tiene la forma del mock
      const result: Loose = await service.getRecentActivity(USER_ID, RecentActivityQuery.parse({ page: '1', limit: '10' }));

      // La fuente audit se consulta con la whitelist client-safe y offset+limit filas.
      expect(auditLogRepository.findClientSafeByUser).toHaveBeenCalledWith(
        USER_ID,
        expect.arrayContaining(['LOGIN_SUCCESS', 'PASSWORD_CHANGED']),
        { limit: 10, offset: 0 }
      );

      // Orden descendente por fecha: el cambio (03-ene) va antes que el audit (02-ene).
      const { merged } = result;
      expect(merged.map((m: Loose) => m.__source)).toEqual(['change', 'audit']);

      // deviceBySession resuelto solo con sesiones del propio usuario.
      expect(userSessionRepository.findByIdsWithDeviceForUser).toHaveBeenCalledWith(
        expect.arrayContaining(['sess1', 'sess2']),
        USER_ID
      );
      const deviceMap = UserActivityListResponseDTO.mock.calls[0][2];
      expect(deviceMap.get('sess1')).toEqual({ deviceId: 'd1', name: 'iPhone' });
      expect(deviceMap.get('sess2')).toBeNull();

      expect(logAudit).toHaveBeenCalledWith('RECENT_ACTIVITY_VIEWED', expect.objectContaining({ actorId: USER_ID, details: { totalItems: 2, page: 1 } })
      );
      expect(result.metadata).toEqual({
        pagination: { currentPage: 1, pageSize: 10, totalItems: 2, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
        sort: { field: 'createdAt', order: 'DESC' }
      });
    });

    it('no consulta dispositivos cuando ningún ítem tiene session_id', async () => {
      auditLogRepository.findClientSafeByUser.mockResolvedValue({
        rows: [{ auditLogId: 'a1', sessionId: null, createdAt: new Date('2026-01-02') }],
        count: 1
      });
      userChangeLogRepository.findExternalChangesByUserId.mockResolvedValue({
        rows: [{ logId: 'c1', originSessionId: null, createdAt: new Date('2026-01-01') }],
        count: 1
      });

      const result: Loose = await service.getRecentActivity(USER_ID, RecentActivityQuery.parse({}));

      expect(userSessionRepository.findByIdsWithDeviceForUser).not.toHaveBeenCalled();
      const deviceMap = UserActivityListResponseDTO.mock.calls[0][2];
      expect(deviceMap.size).toBe(0);
      expect(result.metadata.pagination.totalItems).toBe(2);
    });
  });
});
