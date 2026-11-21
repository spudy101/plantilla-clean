// tests/unit/modules/admin/records/audit/services/admin-session-trace.service.test.ts
//
// AdminSessionTraceService — superficie forense de trazabilidad por sesión. Probamos: listado con
// conteo de acciones por sesión, timeline (404 + hidratación perezosa vía hasDetailFn) e hidratación
// por lote de entidades (agrupado por tabla, tablas no registradas → skipped, filtro por entityTable).
// Repos, DTOs y componentes de auditoría van mockeados.

jest.mock('../repositories/audit-log.repository', () => ({
  findPaginatedWithExecutor: jest.fn(),
  countBySessionIds: jest.fn(),
  findEntityRefsBySession: jest.fn()
}));

jest.mock('../../iam/repositories/user-session.repository', () => ({
  buildWhere: jest.fn(),
  findPaginatedWithDeviceAndUser: jest.fn(),
  findByIdWithDeviceAndUser: jest.fn(),
  findById: jest.fn()
}));

jest.mock('../../legal/infrastructure/persistence/prisma-user-consent.repository', () => ({
  findByIds: jest.fn()
}));

jest.mock('../../notification/repositories/user-notification-preference.repository', () => ({
  findByIds: jest.fn()
}));

jest.mock('../../iam/repositories/auth-trusted-device.repository', () => ({
  findByIds: jest.fn()
}));

jest.mock('../../legal/application/dto/user-consent.output', () => ({
  toUserConsentOutput: jest.fn(r => ({ built: 'consent', id: r.userConsentId }))
}));

jest.mock('../responses/audit-components.response', () => ({
  NotificationPreferenceComponent: { build: jest.fn(r => ({ built: 'pref', id: r.id })) },
  TrustedDeviceComponent: { build: jest.fn(r => ({ built: 'device', id: r.userTrustedDeviceId })) }
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../audit.service', () => ({ record: jest.fn() }));


jest.mock('../responses/admin-session-trace.response', () => ({
  SessionTraceListDTO: jest.fn(() => ({ dto: 'list' })),
  SessionTimelineDTO: jest.fn(() => ({ dto: 'timeline' })),
  SessionEntitiesDTO: jest.fn(() => ({ dto: 'entities' }))
}));

import { mocked } from 'tests/helpers/mock';
import auditLogRepositoryModule from '../repositories/audit-log.repository';
const auditLogRepository = mocked(auditLogRepositoryModule);
import userSessionRepositoryModule from '../../iam/repositories/user-session.repository';
const userSessionRepository = mocked(userSessionRepositoryModule);
const userConsentRepositoryModule = jest.requireMock<import('../../legal/infrastructure/persistence/prisma-user-consent.repository').PrismaUserConsentRepository>('../../legal/infrastructure/persistence/prisma-user-consent.repository');
const userConsentRepository = mocked(userConsentRepositoryModule);
import trustedDeviceRepoModule from '../../iam/repositories/auth-trusted-device.repository';
const trustedDeviceRepo = mocked(trustedDeviceRepoModule);
import auditServiceModule from '../audit.service';
const logAudit = mocked(auditServiceModule).record;
import adminSessionTraceDtoModuleModule from '../responses/admin-session-trace.response';
const adminSessionTraceDtoModule = mocked(adminSessionTraceDtoModuleModule);
const {
  SessionTraceListDTO,
  SessionTimelineDTO,
  SessionEntitiesDTO
} = mocked(adminSessionTraceDtoModule);
import service from './admin-session-trace.service';
import { SessionListQuery, SessionTimelineQuery } from '../requests/audit.request';

const ADMIN_ID = 'admin-1';

describe('AdminSessionTraceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userSessionRepository.buildWhere.mockReturnValue({});
  });

  describe('listSessions', () => {
    it('lista sesiones y arma el countMap de acciones por sesión', async () => {
      userSessionRepository.findPaginatedWithDeviceAndUser.mockResolvedValue({
        rows: [{ userSessionId: 's1' }, { userSessionId: 's2' }],
        count: 2
      });
      auditLogRepository.countBySessionIds.mockResolvedValue([
        { sessionId: 's1', count: 3 },
        { sessionId: 's2', count: 0 }
      ]);

      const result = await service.listSessions(SessionListQuery.parse({ userId: '11111111-1111-4111-8111-111111111111' }), ADMIN_ID);

      expect(auditLogRepository.countBySessionIds).toHaveBeenCalledWith(['s1', 's2']);
      expect(SessionTraceListDTO).toHaveBeenCalledWith(
        [{ userSessionId: 's1' }, { userSessionId: 's2' }],
        new Map([
          ['s1', 3],
          ['s2', 0]
        ]),
        expect.objectContaining({ pagination: expect.objectContaining({ totalItems: 2 }), sort: { field: 'startedAt', order: 'DESC' } })
      );
      expect(logAudit).toHaveBeenCalledWith('SESSION_TRACE_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ totalItems: 2, filters: ['userId'] }) })
      );
      expect(result).toEqual({ dto: 'list' });
    });
  });

  describe('getSessionTimeline', () => {
    it('lanza 404 cuando la sesión no existe', async () => {
      userSessionRepository.findByIdWithDeviceAndUser.mockResolvedValue(null);

      await expect(service.getSessionTimeline('nope', SessionTimelineQuery.parse({}), ADMIN_ID)).rejects.toThrow('Sesión no encontrada');
    });

    it('devuelve el timeline y marca hasDetail solo para tablas registradas con id', async () => {
      userSessionRepository.findByIdWithDeviceAndUser.mockResolvedValue({ userSessionId: 's1' });
      auditLogRepository.findPaginatedWithExecutor.mockResolvedValue({
        rows: [
          { entityTable: 'user_consents', entityId: 'c1' },
          { entityTable: 'tabla_no_registrada', entityId: 'x1' },
          { entityTable: 'user_consents', entityId: null }
        ],
        count: 3
      });

      await service.getSessionTimeline('s1', SessionTimelineQuery.parse({}), ADMIN_ID);

      // Cronológico por defecto (createdAt ASC)
      expect(auditLogRepository.findPaginatedWithExecutor).toHaveBeenCalledWith(
        { sessionId: 's1' },
        { page: 1, limit: 10, offset: 0, sortBy: 'createdAt', order: 'ASC' }
      );

      expect(logAudit).toHaveBeenCalledWith('SESSION_TRACE_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ sessionId: 's1', totalItems: 3 }) })
      );

      // La función hasDetailFn se pasa como último argumento del DTO: la ejercitamos directamente.
      const hasDetailFn = SessionTimelineDTO.mock.calls[0][4];
      expect(hasDetailFn({ entityTable: 'user_consents', entityId: 'c1' })).toBe(true);
      expect(hasDetailFn({ entityTable: 'tabla_no_registrada', entityId: 'x1' })).toBe(false);
      expect(hasDetailFn({ entityTable: 'user_consents', entityId: null })).toBe(false);
    });
  });

  describe('getSessionEntities', () => {
    it('lanza 404 cuando la sesión no existe', async () => {
      userSessionRepository.findById.mockResolvedValue(null);

      await expect(service.getSessionEntities('nope', {}, ADMIN_ID)).rejects.toThrow('Sesión no encontrada');
    });

    it('hidrata por lote, agrupa ids únicos por tabla y reporta tablas no registradas en skipped', async () => {
      userSessionRepository.findById.mockResolvedValue({ userSessionId: 's1' });
      auditLogRepository.findEntityRefsBySession.mockResolvedValue([
        { entityTable: 'user_consents', entityId: 'c1' },
        { entityTable: 'user_consents', entityId: 'c1' }, // duplicado → un solo id
        { entityTable: 'user_trusted_devices', entityId: 'd1' },
        { entityTable: 'foo_table', entityId: 'z1' }
      ]);
      userConsentRepository.findByIds.mockResolvedValue([{ userConsentId: 'c1' }]);
      trustedDeviceRepo.findByIds.mockResolvedValue([{ userTrustedDeviceId: 'd1' }]);

      await service.getSessionEntities('s1', {}, ADMIN_ID);

      // ids únicos por tabla
      expect(userConsentRepository.findByIds).toHaveBeenCalledWith(['c1'], 'userConsentId');

      const [sessionIdArg, entities, skipped] = SessionEntitiesDTO.mock.calls[0];
      expect(sessionIdArg).toBe('s1');
      expect(entities).toEqual([
        expect.objectContaining({ entityTable: 'user_consents', entityType: 'UserConsent', count: 1 }),
        expect.objectContaining({ entityTable: 'user_trusted_devices', entityType: 'UserTrustedDevice', count: 1 })
      ]);
      expect(skipped).toEqual([{ entityTable: 'foo_table', count: 1 }]);
      expect(logAudit).toHaveBeenCalledWith('SESSION_TRACE_ENTITIES_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ tables: ['user_consents', 'user_trusted_devices'], skipped: ['foo_table'] }) })
      );
    });

    it('acota la hidratación a una sola tabla con ?entityTable', async () => {
      userSessionRepository.findById.mockResolvedValue({ userSessionId: 's1' });
      auditLogRepository.findEntityRefsBySession.mockResolvedValue([
        { entityTable: 'user_consents', entityId: 'c1' },
        { entityTable: 'user_trusted_devices', entityId: 'd1' }
      ]);
      userConsentRepository.findByIds.mockResolvedValue([{ userConsentId: 'c1' }]);

      await service.getSessionEntities('s1', { entityTable: 'user_consents' }, ADMIN_ID);

      expect(userConsentRepository.findByIds).toHaveBeenCalledTimes(1);
      expect(trustedDeviceRepo.findByIds).not.toHaveBeenCalled();
    });
  });
});
