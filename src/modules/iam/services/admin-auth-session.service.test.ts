// tests/unit/modules/admin/kyc/iam/services/admin-auth-session.service.test.ts
//
// AdminAuthSessionService — vista admin de sesiones e intentos de autenticación. Probamos: listado de
// sesiones (con y sin filtro sessionId), listado por usuario, revocación de sesión (camino feliz +
// notFound + ya cerrada + ramas de warn en Redis) y listado de intentos (scope all/login, por usuario).
// Todo el I/O (repos, RefreshTokenStore, blacklist, notificaciones, DTOs) va mockeado.

jest.mock('../repositories/user-session.repository', () => ({
  buildWhere: jest.fn(),
  findPaginatedWithDeviceAndUser: jest.fn(),
  findByIdWithDeviceAndUser: jest.fn(),
  findById: jest.fn(),
  closeSession: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../audit/infrastructure/persistence/prisma-audit-log.repository', () => ({
  findAuthAttemptsPaginated: jest.fn()
}));

jest.mock('../utils/refresh-token-store.util', () => ({
  revoke: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../utils/token-blacklist.util', () => ({
  blacklistSession: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../notification/infrastructure/legacy/notifier', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));

jest.mock('../../../shared/infrastructure/config', () => ({
  notifications: { ses: { logoUrl: 'https://logo.test/logo.png' } }
}));


jest.mock('../responses/admin-auth-session.response', () => ({
  SessionListDTO: jest.fn(() => ({ dto: 'sessions' })),
  AuthAttemptListDTO: jest.fn(() => ({ dto: 'attempts' }))
}));

import { mocked, Loose } from 'tests/helpers/mock';
import userSessionRepositoryModule from '../repositories/user-session.repository';
const userSessionRepository = mocked(userSessionRepositoryModule);
const auditLogRepositoryModule = jest.requireMock<import('../../audit/infrastructure/persistence/prisma-audit-log.repository').PrismaAuditLogRepository>('../../audit/infrastructure/persistence/prisma-audit-log.repository');
const auditLogRepository = mocked(auditLogRepositoryModule);
import RefreshTokenStoreModule from '../utils/refresh-token-store.util';
const RefreshTokenStore = mocked(RefreshTokenStoreModule);
import TokenBlacklistUtilModule from '../utils/token-blacklist.util';
const TokenBlacklistUtil = mocked(TokenBlacklistUtilModule);
import NotificationCreationServiceModule from '../../notification/infrastructure/legacy/notifier';
const notifier = mocked(NotificationCreationServiceModule);
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
import auditServiceModule from '../../audit/infrastructure/legacy/audit-recorder';
const { logger } = mocked(loggerUtilModule);
const logAudit = mocked(auditServiceModule).record;
import adminAuthSessionDtoModule from '../responses/admin-auth-session.response';
const { SessionListDTO, AuthAttemptListDTO } = mocked(adminAuthSessionDtoModule);
import service from './admin-auth-session.service';

// Helper de flush con cuerpo de bloque (eslint no-promise-executor-return).
const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

const ADMIN_ID = 'admin-1';

/** La query como la deja validate(): página 1 de 10 por createdAt DESC, más los filtros del caso. */
const q = <T>(filters: Loose = {}): T => ({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC', ...filters }) as T;

describe('AdminAuthSessionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userSessionRepository.buildWhere.mockReturnValue({});
    userSessionRepository.findPaginatedWithDeviceAndUser.mockResolvedValue({ rows: [{ userSessionId: 's1' }], count: 1 });
    auditLogRepository.findAuthAttemptsPaginated.mockResolvedValue({ rows: [{ audit_log_id: 'a1' }], count: 1 });
  });

  describe('listSessions', () => {
    it('pagina, audita y delega en SessionListDTO', async () => {
      const result = await service.listSessions(q({ page: 2, limit: 5, sortBy: 'startedAt' }), ADMIN_ID);

      expect(userSessionRepository.findPaginatedWithDeviceAndUser).toHaveBeenCalledWith({}, { page: 2, limit: 5, offset: 5, sortBy: 'startedAt', order: 'DESC' });

      expect(userSessionRepository.findPaginatedWithDeviceAndUser).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledWith('AUTH_SESSION_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: { totalItems: 1 }, entityType: 'AuthSession' })
      );
      expect(SessionListDTO).toHaveBeenCalledWith(
        [{ userSessionId: 's1' }],
        {
          pagination: { currentPage: 2, pageSize: 5, totalItems: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: true },
          sort: { field: 'startedAt', order: 'DESC' }
        }
      );
      expect(result).toEqual({ dto: 'sessions' });
    });

    it('propaga el filtro sessionId cuando viene en el query', async () => {
      await service.listSessions(q({ sessionId: 'sess-9', dateFrom: new Date('2026-11-01') }), ADMIN_ID);

      // Las fechas llegan como Date (las convierte el esquema) y ahora sí se filtran
      expect(userSessionRepository.buildWhere).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-9', dateFrom: new Date('2026-11-01') }));

      expect(SessionListDTO).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filters: { sessionId: 'sess-9', dateFrom: new Date('2026-11-01') } })
      );
    });
  });

  describe('getSessionsByUser', () => {
    it('arma el where por usuario/estado, audita y responde el DTO', async () => {
      await service.getSessionsByUser('user-7', q({ status: 'active' }), ADMIN_ID);

      expect(userSessionRepository.buildWhere).toHaveBeenCalledWith({ userId: 'user-7', status: 'active' });
      expect(logAudit).toHaveBeenCalledWith('AUTH_SESSION_BY_USER_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: { targetUserId: 'user-7' }, entityId: 'user-7' })
      );
      expect(SessionListDTO).toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    const activeSession = { status: 'active', jti: 'jti-1', userId: 'user-9' };

    it('cierra la sesión, revoca en Redis, audita y notifica (admin + cliente)', async () => {
      userSessionRepository.findById.mockResolvedValue(activeSession);

      const result = await service.revokeSession('sess-1', ADMIN_ID);

      expect(userSessionRepository.closeSession).toHaveBeenCalledWith('sess-1', 'revoked_by_admin');
      expect(RefreshTokenStore.revoke).toHaveBeenCalledWith('jti-1');
      expect(TokenBlacklistUtil.blacklistSession).toHaveBeenCalledWith('sess-1');
      expect(logAudit).toHaveBeenCalledWith('AUTH_SESSION_REVOKED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ targetUserId: 'user-9', jti: 'jti-1' }), entityId: 'sess-1' })
      );
      expect(result).toEqual({ sessionId: 'sess-1', status: 'closed', closeReason: 'revoked_by_admin' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledTimes(2);
      const tipos = notifier.notify.mock.calls.map(c => c[0].type);
      expect(tipos).toEqual(['AUTH_SESSION_REVOKED_INTERNAL', 'AUTH_SESSION_REVOKED_CLIENT']);
    });

    it('lanza 404 cuando la sesión no existe', async () => {
      userSessionRepository.findById.mockResolvedValue(null);

      await expect(service.revokeSession('nope', ADMIN_ID)).rejects.toThrow('Sesión no encontrada');
      expect(userSessionRepository.closeSession).not.toHaveBeenCalled();
    });

    it('lanza 400 cuando la sesión ya está cerrada', async () => {
      userSessionRepository.findById.mockResolvedValue({ status: 'closed', jti: 'j', userId: 'u' });

      await expect(service.revokeSession('sess-1', ADMIN_ID)).rejects.toThrow('La sesión ya está cerrada');
      expect(userSessionRepository.closeSession).not.toHaveBeenCalled();
    });

    it('registra warn si falla la revocación de JTI en Redis (best-effort)', async () => {
      userSessionRepository.findById.mockResolvedValue(activeSession);
      RefreshTokenStore.revoke.mockRejectedValueOnce(new Error('redis down'));

      await service.revokeSession('sess-1', ADMIN_ID);
      await flush();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error revocando JTI'),
        expect.objectContaining({ error: 'redis down' })
      );
    });

    it('registra warn si falla la invalidación del access token en Redis', async () => {
      userSessionRepository.findById.mockResolvedValue(activeSession);
      TokenBlacklistUtil.blacklistSession.mockRejectedValueOnce(new Error('blacklist fail'));

      await service.revokeSession('sess-1', ADMIN_ID);
      await flush();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error invalidando la sesión'),
        expect.objectContaining({ error: 'blacklist fail' })
      );
    });

    it('registra warn si falla el envío de una notificación', async () => {
      userSessionRepository.findById.mockResolvedValue(activeSession);
      notifier.notify.mockRejectedValue(new Error('notif fail'));

      await service.revokeSession('sess-1', ADMIN_ID);
      await flush();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/AUTH_SESSION_REVOKED/), expect.objectContaining({ error: 'notif fail' }));
    });
  });

  describe('listAttempts', () => {
    it('scope por defecto = all → filtra por categoría Autenticación', async () => {
      await service.listAttempts(q(), ADMIN_ID);

      const criteria = auditLogRepository.findAuthAttemptsPaginated.mock.calls[0][0];
      // el service arma criterios de negocio; el WHERE (Op.between / Op.in) lo arma el repositorio
      expect(criteria.category).toBe('Autenticación');
      expect(criteria.actions).toBeUndefined();
      expect(criteria.from).toBeInstanceOf(Date);
      expect(criteria.to).toBeInstanceOf(Date);
      expect(logAudit).toHaveBeenCalledWith('AUTH_ATTEMPTS_LIST_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ scope: 'all' }) })
      );
      expect(AuthAttemptListDTO).toHaveBeenCalledWith(
        [{ audit_log_id: 'a1' }],
        expect.objectContaining({ sort: { field: 'createdAt', order: 'DESC' }, filters: { scope: 'all' } })
      );
    });

    it('scope=login → filtra por acciones de login (no toda la categoría)', async () => {
      await service.listAttempts(q({ scope: 'login', userId: 'u-1', outcome: 'FAILED' }), ADMIN_ID);

      const criteria = auditLogRepository.findAuthAttemptsPaginated.mock.calls[0][0];
      expect(criteria.actions).toEqual(expect.any(Array));
      expect(criteria.category).toBeUndefined();
      expect(criteria.userId).toBe('u-1');
      expect(criteria.outcome).toBe('FAILED');
    });
  });

  describe('getAttemptsByUser', () => {
    it('fuerza el user_id del path por sobre el del query y audita', async () => {
      await service.getAttemptsByUser('user-target', q({ userId: 'ignorado', scope: 'all' }), ADMIN_ID);

      const criteria = auditLogRepository.findAuthAttemptsPaginated.mock.calls[0][0];
      expect(criteria.userId).toBe('user-target');
      expect(logAudit).toHaveBeenCalledWith('AUTH_ATTEMPTS_BY_USER_VIEWED', expect.objectContaining({ actorId: ADMIN_ID, details: expect.objectContaining({ targetUserId: 'user-target', scope: 'all' }), entityId: 'user-target' })
      );
    });
  });
});
