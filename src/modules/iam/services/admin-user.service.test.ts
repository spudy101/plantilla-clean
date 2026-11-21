// tests/unit/modules/admin/kyc/iam/services/admin-user.service.test.ts
//
// AdminUserService — gestión de USUARIOS INTERNOS (empleados). Servicio grande: se cubren las ramas
// principales de cada operación (list/detail, create, update, changeRole, setStatus, delete, sesiones
// y bitácora) más las protecciones de superadmin, cuentas eliminadas y doble aprobación. Repos,
// helpers, DTOs, paginación, notificaciones, constantes y logger se mockean para aislar la
// orquestación del servicio. Las notificaciones se disparan en setImmediate → se vacía la cola de
// macrotareas antes de assertar sobre ellas.

jest.mock('../repositories/user.repository', () => ({
  findAllPaginated: jest.fn(),
  findByUserId: jest.fn(),
  findById: jest.fn(),
  findForAccountDeletion: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
  setActiveStatus: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../person/repositories/person.repository', () => ({
  update: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../repositories/role.repository', () => ({
  findAll: jest.fn(),
  findByNames: jest.fn(),
  findByName: jest.fn(),
  findById: jest.fn()
}));

jest.mock('../../catalogs/repositories/document-type.repository', () => ({
  findByCode: jest.fn()
}));

jest.mock('../repositories/user-session.repository', () => ({
  findActiveByUser: jest.fn(),
  closeAllByUser: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../audit/repositories/change-log.repository', () => ({
  findByUserId: jest.fn()
}));

jest.mock('../helpers/internal-user.helper', () => ({
  createInternalUser: jest.fn()
}));

jest.mock('../../person/helpers/profile.helper', () => ({
  validateNationalIdUnique: jest.fn().mockResolvedValue(undefined),
  validateEmailUnique: jest.fn().mockResolvedValue(undefined),
  validateCurrentPassword: jest.fn().mockResolvedValue(undefined),
  deleteAccountLogic: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../person/utils/kyc-shared.util', () => ({
  generateSecurePassword: jest.fn().mockReturnValue('TempPass123!'),
  logChange: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../utils/token-blacklist.util', () => ({
  invalidateUserSessions: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/database/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));

jest.mock('../../../shared/http/app-error.util', () => ({
  notFound: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 404 }),
  badRequest: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 400 }),
  forbidden: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 403 }),
  conflict: (msg: Loose, extra: Loose) => Object.assign(new Error(msg), { statusCode: 409, ...extra }),
  internal: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 500 })
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../../../shared/constants', () => ({
  INTERNAL_ROLE_NAMES: ['auditor', 'admin', 'super_admin'],
  SUPERADMIN_ROLE_NAMES: ['super_admin'],
  RBAC_ROLES: { AUDITOR: 'auditor' },
  notifications: { ses: { logoUrl: 'https://logo.test/x.png' } }
}));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../approvals/services/dual-approval.service', () => ({
  annotatePending: jest.fn().mockResolvedValue(undefined),
  gate: jest.fn().mockResolvedValue({ pending: false })
}));

jest.mock('../../audit/utils/audit-diff.util', () => ({
  buildAuditDiff: jest.fn().mockReturnValue({ before: { firstName: 'A' }, after: { firstName: 'B' } })
}));

jest.mock('../responses/admin-user.response', () => ({
  InternalUserDTO: (u: Loose) => (u ? { dto: 'user', ...u } : null),
  InternalUserListDTO: (u: Loose) => ({ dto: 'list', ...u }),
  InternalUserCreatedDTO: (u: Loose, pwd: Loose) => ({ dto: 'created', temporaryPassword: pwd, ...u }),
  UserSessionDTO: (s: Loose) => ({ dto: 'session', ...s }),
  UserChangeLogDTO: (l: Loose) => ({ dto: 'log', ...l }),
  RoleOptionDTO: (r: Loose) => ({ dto: 'role', ...r })
}));

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked, Loose } from 'tests/helpers/mock';
import userRepositoryModule from '../repositories/user.repository';
const userRepository = mocked(userRepositoryModule);
import personRepositoryModule from '../../person/repositories/person.repository';
const personRepository = mocked(personRepositoryModule);
import roleRepositoryModule from '../repositories/role.repository';
const roleRepository = mocked(roleRepositoryModule);
import documentTypeRepositoryModule from '../../catalogs/repositories/document-type.repository';
const documentTypeRepository = mocked(documentTypeRepositoryModule);
import userSessionRepositoryModule from '../repositories/user-session.repository';
const userSessionRepository = mocked(userSessionRepositoryModule);
import userChangeLogRepositoryModule from '../../audit/repositories/change-log.repository';
const userChangeLogRepository = mocked(userChangeLogRepositoryModule);
import InternalUserHelperModule from '../helpers/internal-user.helper';
const InternalUserHelper = mocked(InternalUserHelperModule);
import ProfileHelperModule from '../../person/helpers/profile.helper';
const ProfileHelper = mocked(ProfileHelperModule);
import KycSharedUtilModule from '../../person/utils/kyc-shared.util';
const KycSharedUtil = mocked(KycSharedUtilModule);
import TokenBlacklistUtilModule from '../utils/token-blacklist.util';
const TokenBlacklistUtil = mocked(TokenBlacklistUtilModule);
import prismaModule from '../../../shared/database/prisma';
const prisma = mocked(prismaModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import NotificationCreationServiceModule from '../../notification/notify';
const notifier = mocked(NotificationCreationServiceModule);
import DualApprovalServiceModule from '../../approvals/services/dual-approval.service';
const DualApprovalService = mocked(DualApprovalServiceModule);
import service from './admin-user.service';

// Helper de cuerpo de bloque para vaciar la cola de macrotareas (setImmediate en notificaciones).
const flush = () => new Promise(resolve => { setImmediate(resolve); });

const AUDIT_CTX = { adminUserId: 'admin-1', ipAddress: '1.2.3.4', userAgent: 'jest' };

// Fábrica de usuario interno (rol auditor por defecto).
const makeUser = (over = {}) => ({
  userId: 'u-1',
  roleId: 'role-auditor',
  isActive: true,
  deletedAt: null,
  role: { name: 'auditor' },
  person: { personId: 'p-1', firstName: 'Juan', lastName: 'Perez' },
  ...over
});

/** La query como la deja validate(): página 1 de 10 por createdAt DESC, más los filtros del caso. */
const q = <T>(filters: Loose = {}): T => ({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC', ...filters }) as T;

describe('AdminUserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    roleRepository.findByNames.mockResolvedValue([{ roleId: 'role-auditor' }, { roleId: 'role-admin' }]);
    userRepository.findByUserId.mockResolvedValue(makeUser());
    DualApprovalService.gate.mockResolvedValue({ pending: false });
    DualApprovalService.annotatePending.mockResolvedValue(undefined);
  });

  // ============================================================
  // LIST / DETAIL
  // ============================================================

  describe('list', () => {
    it('lista usuarios internos, anota pendientes, audita y arma metadata con filtros activos', async () => {
      userRepository.findAllPaginated.mockResolvedValue({ rows: [makeUser()], count: 1 });

      const result = await service.list(q({ roleId: 'role-admin', isActive: true, search: 'jua' }), 'admin-1');

      // roleId interno válido → se filtra por ese rol; se excluye al solicitante.
      expect(userRepository.findAllPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ roleIds: ['role-admin'], excludeUserId: 'admin-1', isActive: true }),
        { page: 1, limit: 10, offset: 0, sortBy: 'createdAt', order: 'DESC' },
        'jua'
      );
      expect(DualApprovalService.annotatePending).toHaveBeenCalledWith('User', expect.any(Array), 'userId');
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_LIST_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { totalItems: 1 } }));
      expect(result.data).toHaveLength(1);
      expect(result.metadata).toMatchObject({ pagination: { totalItems: 1 }, filters: { search: 'jua', roleId: 'role-admin', isActive: true } });
    });

    it('si el roleId no es interno cae a todos los roles listables y no expone filtro de rol', async () => {
      userRepository.findAllPaginated.mockResolvedValue({ rows: [], count: 0 });

      const result = await service.list(q({ roleId: 'role-cliente' }), 'admin-1');

      expect(userRepository.findAllPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ roleIds: ['role-auditor', 'role-admin'] }),
        expect.any(Object),
        null
      );
      // roleId inválido igual figura en activeFilters (se agrega si query.roleId existe).
      expect(result.metadata.filters).toEqual({ roleId: 'role-cliente' });
    });
  });

  describe('listDeleted', () => {
    it('lista solo eliminados (onlyDeleted) y audita', async () => {
      userRepository.findAllPaginated.mockResolvedValue({ rows: [makeUser({ deletedAt: new Date() })], count: 1 });

      const result = await service.listDeleted(q(), 'admin-1');

      expect(userRepository.findAllPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ onlyDeleted: true }),
        expect.any(Object),
        null
      );
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_DELETED_LIST_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { totalItems: 1 } }));
      expect(result.data).toHaveLength(1);
    });
  });

  describe('listRoleOptions', () => {
    it('devuelve los roles internos mapeados y audita', async () => {
      roleRepository.findByNames.mockResolvedValue([{ roleId: 'r1', name: 'auditor' }]);

      const result = await service.listRoleOptions('admin-1');

      // el service pide roles por nombre de negocio; el repositorio arma el IN / NOT IN
      expect(roleRepository.findByNames).toHaveBeenCalledWith(expect.any(Array), { exclude: expect.any(Array) });
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_ROLE_OPTIONS_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { totalItems: 1 } })
      );
      expect(result).toEqual([{ dto: 'role', roleId: 'r1', name: 'auditor' }]);
    });
  });

  describe('getById', () => {
    it('devuelve el detalle del usuario interno y audita', async () => {
      const result = await service.getById('u-1', 'admin-1');

      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { targetUserId: 'u-1' } }));
      expect(result).toMatchObject({ dto: 'user', userId: 'u-1' });
    });

    it('lanza 404 si el usuario no existe', async () => {
      userRepository.findByUserId.mockResolvedValue(null);
      await expect(service.getById('u-x', 'admin-1')).rejects.toThrow('Usuario no encontrado');
    });

    it('lanza 404 si el usuario no tiene rol interno', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ role: { name: 'cliente' } }));
      await expect(service.getById('u-1', 'admin-1')).rejects.toThrow('Usuario interno no encontrado');
    });
  });

  // ============================================================
  // CREATE
  // ============================================================

  describe('create', () => {
    const data = { email: 'nuevo@x.com', firstName: 'Ana', lastName: 'Diaz', nationalId: 'SYS-1' };

    beforeEach(() => {
      roleRepository.findByName.mockResolvedValue({ roleId: 'role-auditor', name: 'auditor' });
      documentTypeRepository.findByCode.mockResolvedValue({ documentTypeId: 'dt-system' });
      InternalUserHelper.createInternalUser.mockResolvedValue({ user: { userId: 'u-new' } });
      userRepository.findByUserId.mockResolvedValue(makeUser({ userId: 'u-new' }));
    });

    it('crea el interno como AUDITOR, valida unicidad, audita, notifica y devuelve la contraseña temporal', async () => {
      const result = await service.create(data, AUDIT_CTX);

      expect(ProfileHelper.validateNationalIdUnique).toHaveBeenCalledWith('SYS-1');
      expect(ProfileHelper.validateEmailUnique).toHaveBeenCalledWith('nuevo@x.com');
      expect(InternalUserHelper.createInternalUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'nuevo@x.com',
          documentTypeId: 'dt-system',
          role: { roleId: 'role-auditor', name: 'auditor' }
        })
      );
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_CREATED', expect.objectContaining({ actorId: 'admin-1', details: expect.objectContaining({ roleName: 'auditor' }) })
      );
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_CREATED', expect.objectContaining({ actorId: 'admin-1', details: expect.objectContaining({ roleName: 'auditor' }) }));
      expect(result).toMatchObject({ dto: 'created', temporaryPassword: 'TempPass123!' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'IAM_INTERNAL_USER_CREATED' })
      );
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'IAM_ADMIN_USER_CREATED' })
      );
    });

    it('lanza error interno si el rol AUDITOR no existe (falta seeder RBAC)', async () => {
      roleRepository.findByName.mockResolvedValue(null);
      await expect(service.create(data, AUDIT_CTX)).rejects.toThrow(/Rol auditor no encontrado/);
    });

    it('lanza error interno si el tipo de documento SYSTEM no existe', async () => {
      documentTypeRepository.findByCode.mockResolvedValue(null);
      await expect(service.create(data, AUDIT_CTX)).rejects.toThrow(/SYSTEM/);
    });
  });

  // ============================================================
  // UPDATE
  // ============================================================

  describe('update', () => {
    it('actualiza datos básicos de la persona, audita el diff y devuelve el DTO fresco', async () => {
      const user = makeUser();
      userRepository.findByUserId.mockResolvedValueOnce(user).mockResolvedValueOnce(makeUser({ userId: 'u-1' }));

      const result = await service.update('u-1', { firstName: 'Nuevo' }, AUDIT_CTX);

      // Se persiste vía repositorio (no con la instancia ORM)
      expect(personRepository.update).toHaveBeenCalledWith('p-1', expect.objectContaining({ firstName: 'Nuevo' }));
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_UPDATED', expect.objectContaining({ actorId: 'admin-1', details: { before: { firstName: 'A' }, after: { firstName: 'B' } } })
      );
      expect(result).toMatchObject({ dto: 'user' });
    });

    it('rechaza (409) modificar una cuenta eliminada', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ deletedAt: new Date() }));
      await expect(service.update('u-1', { firstName: 'X' }, AUDIT_CTX)).rejects.toThrow(/eliminado/);
    });
  });

  // ============================================================
  // CHANGE ROLE
  // ============================================================

  describe('changeRole', () => {
    beforeEach(() => {
      roleRepository.findById.mockResolvedValue({ roleId: 'role-admin', name: 'admin' });
    });

    it('prohíbe cambiar el rol de un superadministrador', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ role: { name: 'super_admin' } }));
      await expect(service.changeRole('u-1', 'role-admin', AUDIT_CTX)).rejects.toThrow(/super administrador/);
    });

    it('rechaza si el usuario ya tiene ese rol', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ roleId: 'role-admin' }));
      await expect(service.changeRole('u-1', 'role-admin', AUDIT_CTX)).rejects.toThrow(/ya tiene este rol/);
    });

    it('rechaza (404) si el rol destino no existe', async () => {
      roleRepository.findById.mockResolvedValue(null);
      await expect(service.changeRole('u-1', 'role-x', AUDIT_CTX)).rejects.toThrow('Rol no encontrado');
    });

    it('rechaza (400) si el rol destino no es interno', async () => {
      roleRepository.findById.mockResolvedValue({ roleId: 'role-cli', name: 'cliente' });
      await expect(service.changeRole('u-1', 'role-cli', AUDIT_CTX)).rejects.toThrow(/no es un rol interno/);
    });

    it('si la doble aprobación queda pendiente devuelve 202 sin ejecutar el cambio', async () => {
      DualApprovalService.gate.mockResolvedValue({ pending: true, request: { id: 'ar-1' } });
      const result = await service.changeRole('u-1', 'role-admin', AUDIT_CTX);

      expect(result).toEqual({ pending: true, approvalRequest: { id: 'ar-1' } });
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('camino inline: ejecuta el cambio (update + bitácora + invalidación + notif)', async () => {
      const result = await service.changeRole('u-1', 'role-admin', AUDIT_CTX);

      expect(userRepository.update).toHaveBeenCalledWith('u-1', { roleId: 'role-admin' });
      expect(KycSharedUtil.logChange).toHaveBeenCalledWith(expect.objectContaining({ changeType: 'role', newValue: 'admin' }));
      expect(userSessionRepository.closeAllByUser).toHaveBeenCalledWith('u-1', 'role_changed');
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_ROLE_CHANGED', expect.objectContaining({ actorId: 'admin-1' }));
      expect(result).toMatchObject({ dto: 'user' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'IAM_INTERNAL_USER_ROLE_CHANGED' }));
    });
  });

  // ============================================================
  // STATUS
  // ============================================================

  describe('setStatus', () => {
    it('prohíbe desactivar a un superadministrador', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ role: { name: 'super_admin' } }));
      await expect(service.setStatus('u-1', false, AUDIT_CTX)).rejects.toThrow(/super administrador/);
    });

    it('rechaza si el usuario ya está en el estado pedido', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ isActive: true }));
      await expect(service.setStatus('u-1', true, AUDIT_CTX)).rejects.toThrow(/ya está activo/);
    });

    it('al desactivar cierra sesiones, registra bitácora, audita y notifica', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ isActive: true }));

      const result = await service.setStatus('u-1', false, AUDIT_CTX);

      expect(userRepository.setActiveStatus).toHaveBeenCalledWith('u-1', false);
      expect(userSessionRepository.closeAllByUser).toHaveBeenCalledWith('u-1', 'account_deactivated');
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_DEACTIVATED', expect.objectContaining({ actorId: 'admin-1' }));
      expect(result).toMatchObject({ dto: 'user' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'IAM_INTERNAL_USER_DEACTIVATED' }));
    });

    it('al activar NO cierra sesiones y audita el alta', async () => {
      userRepository.findByUserId.mockResolvedValue(makeUser({ isActive: false }));

      await service.setStatus('u-1', true, AUDIT_CTX);

      expect(userSessionRepository.closeAllByUser).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_ACTIVATED', expect.objectContaining({ actorId: 'admin-1' }));
    });
  });

  // ============================================================
  // DELETE
  // ============================================================

  describe('deleteUser', () => {
    beforeEach(() => {
      // 1ª llamada: adminUser (maker); 2ª: el target interno.
      userRepository.findByUserId.mockReset();
      userRepository.findByUserId.mockResolvedValueOnce({ passwordHash: 'hash' }).mockResolvedValueOnce(makeUser());
      // executeDeleteUser usa una transacción propia.
      prisma.$transaction.mockImplementation(managedTransaction({
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        finished: false
      }));
      userRepository.findForAccountDeletion.mockResolvedValue({
        userId: 'u-1',
        username: 'jperez',
        person: { personId: 'p-1', nationalId: 'SYS-1', firstName: 'Juan', contact: { email: 'j@x.com' } }
      });
    });

    it('lanza 404 si el administrador (maker) no existe', async () => {
      userRepository.findByUserId.mockReset();
      userRepository.findByUserId.mockResolvedValueOnce(null);
      await expect(service.deleteUser('u-1', 'pwd', AUDIT_CTX)).rejects.toThrow('Administrador no encontrado');
    });

    it('prohíbe eliminar a un superadministrador', async () => {
      userRepository.findByUserId.mockReset();
      userRepository.findByUserId
        .mockResolvedValueOnce({ passwordHash: 'hash' })
        .mockResolvedValueOnce(makeUser({ role: { name: 'super_admin' } }));
      await expect(service.deleteUser('u-1', 'pwd', AUDIT_CTX)).rejects.toThrow(/super administrador/);
    });

    it('si la doble aprobación queda pendiente devuelve 202 sin eliminar', async () => {
      DualApprovalService.gate.mockResolvedValue({ pending: true, request: { id: 'ar-9' } });
      const result = await service.deleteUser('u-1', 'pwd', AUDIT_CTX);

      expect(result).toEqual({ pending: true, approvalRequest: { id: 'ar-9' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('camino inline: reautentica, ejecuta la ofuscación en transacción y confirma la eliminación', async () => {
      const result = await service.deleteUser('u-1', 'pwd', AUDIT_CTX);

      expect(ProfileHelper.validateCurrentPassword).toHaveBeenCalledWith('hash', 'pwd');
      expect(ProfileHelper.deleteAccountLogic).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', personId: 'p-1' }));
      expect(userSessionRepository.closeAllByUser).toHaveBeenCalledWith('u-1', 'account_deleted');
      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_DELETED', expect.objectContaining({ actorId: 'admin-1' }));
      expect(result).toEqual({ userId: 'u-1', deleted: true });
    });
  });

  describe('executeDeleteUser', () => {
    it('hace rollback y propaga si el usuario no existe dentro de la transacción', async () => {
      const tx = { commit: jest.fn(), rollback: jest.fn().mockResolvedValue(undefined), finished: false };
      prisma.$transaction.mockImplementation(managedTransaction(tx));
      userRepository.findForAccountDeletion.mockResolvedValue(null);

      await expect(service.executeDeleteUser('u-1', AUDIT_CTX)).rejects.toThrow('Usuario no encontrado');
      expect(tx.rollback).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // SESIONES / BITÁCORA
  // ============================================================

  describe('listSessions', () => {
    it('devuelve las sesiones activas mapeadas y audita', async () => {
      userSessionRepository.findActiveByUser.mockResolvedValue([{ userSessionId: 's-1' }]);

      const result = await service.listSessions('u-1', 'admin-1');

      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_SESSIONS_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { targetUserId: 'u-1' } })
      );
      expect(result).toEqual([{ dto: 'session', userSessionId: 's-1' }]);
    });
  });

  describe('closeSessions', () => {
    it('invalida sesiones, audita, notifica y responde closed', async () => {
      const result = await service.closeSessions('u-1', AUDIT_CTX);

      expect(userSessionRepository.closeAllByUser).toHaveBeenCalledWith('u-1', 'closed_by_admin');
      expect(TokenBlacklistUtil.invalidateUserSessions).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ userId: 'u-1', closed: true });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'IAM_INTERNAL_USER_SESSIONS_CLOSED' }));
    });
  });

  describe('listChangeLogs', () => {
    it('devuelve la bitácora paginada del usuario y audita', async () => {
      userChangeLogRepository.findByUserId.mockResolvedValue({ rows: [{ id: 'l-1' }], count: 1 });

      const result = await service.listChangeLogs('u-1', q(), 'admin-1');

      expect(logAudit).toHaveBeenCalledWith('INTERNAL_USER_CHANGE_LOGS_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { targetUserId: 'u-1' } }));
      expect(result.data).toEqual([{ dto: 'log', id: 'l-1' }]);
      expect(result.metadata).toMatchObject({ pagination: { totalItems: 1 }, sort: { field: 'createdAt', order: 'DESC' } });
    });
  });
});
