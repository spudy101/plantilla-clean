// tests/unit/modules/admin/kyc/person/services/admin-person.service.test.ts
//
// PersonService (admin) — CRUD y operaciones administrativas sobre cuentas de cliente. Es un servicio
// grande y transaccional; aquí cubrimos las ramas principales de cada operación aislando TODA la
// infraestructura (repositorios, helpers, utils, DTOs, constantes, cliente de Prisma). Verificamos:
//   - list/listDeleted/listRoleOptions/getById: filtros, roles cliente, auditoría y not-found.
//   - create: camino feliz (commit + auditoría + notificaciones en background) y rol no configurado.
//   - _toggleStatus (activate/deactivate): feliz, not-found, cuenta eliminada, ya activo/inactivo.
//   - resetPassword / changeEmail / changeNationalId (feliz + idempotente) / disableMFA (feliz + sin MFA).
//   - changeRole: feliz + guardas (admin intocable, rol inexistente, mismo rol).
//   - deleteAccount: doble aprobación pendiente vs. ejecución inline; executeDeleteAccount feliz.
// Las notificaciones se disparan en setImmediate → se vacía la cola de macrotareas antes de assertar.

// --- Infra base (node_modules) ---
jest.mock('uuid', () => ({ v4: jest.fn(() => 'uuid-fixed') }));

// --- cliente de Prisma: fábrica de transacción controlable por test ---
jest.mock('../../../shared/infrastructure/database/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));

// --- Repositorios ---
jest.mock('../../iam/repositories/user.repository', () => ({
  findByUserId: jest.fn(),
  findAdminTarget: jest.fn(),
  findAllPaginated: jest.fn(),
  createWithPassword: jest.fn(),
  setActiveStatus: jest.fn(),
  updatePassword: jest.fn(),
  update: jest.fn()
}));
jest.mock('../repositories/person.repository', () => ({
  create: jest.fn()
}));
jest.mock('../repositories/person-contact.repository', () => ({
  create: jest.fn()
}));
jest.mock('../../iam/repositories/role.repository', () => ({
  findAll: jest.fn(),
  findByNames: jest.fn(),
  findByName: jest.fn(),
  findById: jest.fn()
}));

// --- Helpers / utils ---
jest.mock('../utils/kyc-shared.util', () => ({
  validateNationalIdByRole: jest.fn(),
  generateSecurePassword: jest.fn(() => 'TempPass123!'),
  logChange: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
  notifyEmail: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../helpers/profile.helper', () => ({
  validateNationalIdUnique: jest.fn().mockResolvedValue(undefined),
  validateEmailUnique: jest.fn().mockResolvedValue(undefined),
  updateEmailLogic: jest.fn(),
  updateNationalIdLogic: jest.fn(),
  validateCurrentPassword: jest.fn().mockResolvedValue(undefined),
  deleteAccountLogic: jest.fn()
}));
jest.mock('../../approvals/services/dual-approval.service', () => ({
  gate: jest.fn()
}));
jest.mock('../../../shared/infrastructure/observability/request-context.util', () => ({
  originFromContext: jest.fn(() => ({ originSessionId: 'sess-1' }))
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));

// AppError real-ish: factories que devuelven Error con statusCode/code para poder usar .rejects.
// Dos roles de cliente para poder probar el cambio entre ellos (la plantilla trae solo CLIENTE).
jest.mock('../../../shared/domain/constants/rbac', () => ({
  ...jest.requireActual('../../../shared/domain/constants/rbac').default,
  CLIENT_ROLE_NAMES: ['CLIENTE', 'CLIENTE_VERIFICADO']
}));

jest.mock('../../../shared/presentation/http/app-error.util', () => {
  const make = (statusCode: number, code: string) => (message: string, details: unknown = null) => {
    return Object.assign(new Error(message), { statusCode, code, details });
  };
  return {
    badRequest: make(400, 'BAD_REQUEST'),
    forbidden: make(403, 'FORBIDDEN'),
    notFound: make(404, 'NOT_FOUND'),
    conflict: make(409, 'CONFLICT'),
    internal: make(500, 'INTERNAL_ERROR')
  };
});

// --- Constantes (el real valida .env y hace process.exit) ---
jest.mock('../../../shared/infrastructure/config', () => ({
  notifications: { ses: { logoUrl: 'https://logo.test/x.png' } },
  RBAC_ROLES: { CLIENTE: 'cliente' },
  CLIENT_ROLE_NAMES: ['cliente', 'cliente_verificado']
}));

// --- DTOs a passthrough/marcadores ---
jest.mock('../responses/admin-person.response', () => ({
  UserDTO: jest.fn(u => ({ dto: 'UserDTO', id: u.userId })),
  UserListItemDTO: jest.fn(u => ({ dto: 'UserListItemDTO', id: u.userId })),
  CreateUserDTO: jest.fn((u, pwd) => ({ dto: 'CreateUserDTO', id: u.userId, pwd })),
  ResetPasswordDTO: jest.fn(u => ({ dto: 'ResetPasswordDTO', id: u.userId })),
  ChangeEmailDTO: jest.fn((u, oldE, newE) => ({ dto: 'ChangeEmailDTO', oldE, newE })),
  ChangeNationalIdDTO: jest.fn((u, oldN, newN) => ({ dto: 'ChangeNationalIdDTO', oldN, newN })),
  ToggleUserStatusDTO: jest.fn((u, action) => ({ dto: 'ToggleUserStatusDTO', action })),
  DisableMFADTO: jest.fn(u => ({ dto: 'DisableMFADTO', id: u.userId })),
  ChangeRoleDTO: jest.fn((u, oldR, newR) => ({ dto: 'ChangeRoleDTO', oldR: oldR.name, newR: newR.name })),
  RoleOptionDTO: jest.fn(r => ({ dto: 'RoleOptionDTO', id: r.roleId }))
}));

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked, Loose } from 'tests/helpers/mock';
import prismaModule from '../../../shared/infrastructure/database/prisma';
const prisma = mocked(prismaModule);
import userRepositoryModule from '../../iam/repositories/user.repository';
const userRepository = mocked(userRepositoryModule);
import personRepositoryModule from '../repositories/person.repository';
const personRepository = mocked(personRepositoryModule);
import personContactRepositoryModule from '../repositories/person-contact.repository';
const personContactRepository = mocked(personContactRepositoryModule);
import roleRepositoryModule from '../../iam/repositories/role.repository';
const roleRepository = mocked(roleRepositoryModule);
import KycSharedUtilModule from '../utils/kyc-shared.util';
const KycSharedUtil = mocked(KycSharedUtilModule);
import NotificationUtilModule from '../../notification/notify';
const notifier = mocked(NotificationUtilModule);
import ProfileHelperModule from '../helpers/profile.helper';
const ProfileHelper = mocked(ProfileHelperModule);
import DualApprovalServiceModule from '../../approvals/services/dual-approval.service';
const DualApprovalService = mocked(DualApprovalServiceModule);
import auditServiceModule from '../../audit/infrastructure/legacy/audit-recorder';
const logAudit = mocked(auditServiceModule).record;
import service from './admin-person.service';

const flushMacrotasks = () => new Promise(resolve => { setImmediate(resolve); });

const AUDIT_CTX = {
  adminUserId: 'admin-1',
  adminFirstName: 'Ana',
  ipAddress: '1.2.3.4',
  userAgent: 'jest'
};

// Transacción con `finished` que se marca al hacer commit/rollback (lo que haría la transacción real).
function makeTransaction() {
  const txn: Record<string, Loose> = { finished: undefined };
  txn.commit = jest.fn().mockImplementation(() => { txn.finished = 'commit'; return Promise.resolve(); });
  txn.rollback = jest.fn().mockImplementation(() => { txn.finished = 'rollback'; return Promise.resolve(); });
  return txn;
}

/** La query como la deja validate() (PersonListQuery): página 1 de 10 por createdAt DESC. */
const q = <T>(filters: Record<string, unknown> = {}): T => ({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC', ...filters }) as T;

describe('PersonService (admin)', () => {
  let txn: Loose;

  beforeEach(() => {
    jest.clearAllMocks();
    txn = makeTransaction();
    prisma.$transaction.mockImplementation(managedTransaction(txn));
    // roles cliente por defecto para _clientRoleIds
    roleRepository.findByNames.mockResolvedValue([{ roleId: 'rc1' }, { roleId: 'rc2' }]);
  });

  // ============================================================
  // CONSULTAS
  // ============================================================

  describe('list', () => {
    it('lista clientes con filtros por defecto (roles cliente) y audita', async () => {
      userRepository.findAllPaginated.mockResolvedValue({ rows: [{ userId: 'u1' }, { userId: 'u2' }], count: 2 });

      const result = await service.list(q(), AUDIT_CTX.adminUserId);

      expect(userRepository.findAllPaginated).toHaveBeenCalledWith(
        { roleIds: ['rc1', 'rc2'] },
        { page: 1, limit: 10, offset: 0, sortBy: 'createdAt', order: 'DESC' },
        null
      );
      expect(logAudit).toHaveBeenCalledWith('PERSON_LIST_VIEWED', { actorId: AUDIT_CTX.adminUserId, details: { totalItems: 2, page: 1 }, entityType: 'User', entityTable: 'users' }
      );
      expect(result.data).toEqual([
        { dto: 'UserListItemDTO', id: 'u1' },
        { dto: 'UserListItemDTO', id: 'u2' }
      ]);
    });

    it('intersecta roleId solicitado con los roles cliente válidos', async () => {
      userRepository.findAllPaginated.mockResolvedValue({ rows: [], count: 0 });

      await service.list(q({ roleId: 'rc1, rX', isActive: true, nationalId: '111', userId: 'u9', search: 'foo' }), 'admin-1');

      expect(userRepository.findAllPaginated).toHaveBeenCalledWith(
        { isActive: true, roleIds: ['rc1'], nationalId: '111', userId: 'u9' },
        expect.any(Object),
        'foo'
      );
    });

    it('si el roleId solicitado no es cliente, cae a todos los roles cliente', async () => {
      userRepository.findAllPaginated.mockResolvedValue({ rows: [], count: 0 });

      await service.list(q({ roleId: 'rX,rY' }), 'admin-1');

      expect(userRepository.findAllPaginated).toHaveBeenCalledWith(
        { roleIds: ['rc1', 'rc2'] },
        expect.any(Object),
        null
      );
    });
  });

  describe('listDeleted', () => {
    it('lista solo cuentas eliminadas (onlyDeleted) y audita', async () => {
      userRepository.findAllPaginated.mockResolvedValue({ rows: [{ userId: 'ud1' }], count: 1 });

      const result = await service.listDeleted(q(), 'admin-1');

      expect(userRepository.findAllPaginated).toHaveBeenCalledWith(
        { roleIds: ['rc1', 'rc2'], onlyDeleted: true },
        expect.any(Object),
        null
      );
      expect(logAudit).toHaveBeenCalledWith('PERSON_DELETED_LIST_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { totalItems: 1, page: 1 } }));
      expect(result.data).toEqual([{ dto: 'UserListItemDTO', id: 'ud1' }]);
    });
  });

  describe('listRoleOptions', () => {
    it('devuelve solo los roles cliente y audita', async () => {
      roleRepository.findByNames.mockResolvedValue([{ roleId: 'rc1' }, { roleId: 'rc2' }]);

      const result = await service.listRoleOptions('admin-1');

      expect(roleRepository.findByNames).toHaveBeenCalledWith(['cliente', 'cliente_verificado']);
      expect(logAudit).toHaveBeenCalledWith('PERSON_ROLE_OPTIONS_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { totalItems: 2 } }));
      expect(result).toEqual([{ dto: 'RoleOptionDTO', id: 'rc1' }, { dto: 'RoleOptionDTO', id: 'rc2' }]);
    });
  });

  describe('getById', () => {
    it('devuelve el usuario y audita PERSON_VIEWED', async () => {
      userRepository.findByUserId.mockResolvedValue({ userId: 'u1' });

      const result = await service.getById('u1', 'admin-1');

      expect(userRepository.findByUserId).toHaveBeenCalledWith('u1', 'full');
      expect(logAudit).toHaveBeenCalledWith('PERSON_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { targetUserId: 'u1' }, entityId: 'u1' }));
      expect(result).toEqual({ dto: 'UserDTO', id: 'u1' });
    });

    it('lanza 404 si el usuario no existe', async () => {
      userRepository.findByUserId.mockResolvedValue(null);
      await expect(service.getById('nope', 'admin-1')).rejects.toThrow('Usuario no encontrado');
    });
  });

  // ============================================================
  // CREACIÓN
  // ============================================================

  describe('create', () => {
    const userData = {
      firstName: 'Juan',
      lastName: 'Pérez',
      nationalId: '11111111-1',
      email: 'juan@test.com'
    };

    beforeEach(() => {
      roleRepository.findByName.mockResolvedValue({ roleId: 'rc1', name: 'cliente' });
      personRepository.create.mockResolvedValue({ personId: 'p1' });
      personContactRepository.create.mockResolvedValue({});
      userRepository.createWithPassword.mockResolvedValue({ userId: 'u1' });
      userRepository.findByUserId.mockResolvedValue({ userId: 'u1' });
    });

    it('crea persona/contacto/usuario, commitea, audita y notifica en background', async () => {
      const result = await service.create(userData, AUDIT_CTX);

      expect(KycSharedUtil.validateNationalIdByRole).toHaveBeenCalledWith('11111111-1', { roleId: 'rc1', name: 'cliente' });
      expect(ProfileHelper.validateNationalIdUnique).toHaveBeenCalledWith('11111111-1');
      expect(ProfileHelper.validateEmailUnique).toHaveBeenCalledWith('juan@test.com');
      expect(personRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Juan', nationalId: '11111111-1' })
      );
      expect(userRepository.createWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ authUsername: 'user_uuid-fixed', personId: 'p1', roleId: 'rc1', password: 'TempPass123!' })
      );
      expect(txn.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PERSON_CREATED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId, details: { roleId: 'rc1', roleName: 'cliente' }, entityId: 'u1' })
      );
      expect(result).toEqual({ dto: 'CreateUserDTO', id: 'u1', pwd: 'TempPass123!' });

      await flushMacrotasks();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'USUARIO_CREADO_ADMIN' }));
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'PERSON_ADMIN_ACTION' }));
    });

    it('lanza error interno y hace rollback si el rol CLIENTE no está configurado', async () => {
      roleRepository.findByName.mockResolvedValue(null);

      await expect(service.create(userData, AUDIT_CTX)).rejects.toThrow(/no configurado/);
      expect(txn.rollback).toHaveBeenCalled();
      expect(txn.commit).not.toHaveBeenCalled();
    });

    it('hace rollback si falla la creación de registros', async () => {
      personRepository.create.mockRejectedValue(new Error('db down'));

      await expect(service.create(userData, AUDIT_CTX)).rejects.toThrow('db down');
      expect(txn.rollback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // ACTIVAR / DESACTIVAR
  // ============================================================

  describe('activate / deactivate', () => {
    const baseUser = {
      userId: 'u1',
      isActive: false,
      deletedAt: null,
      person: { firstName: 'Juan', contact: { email: 'juan@test.com' } }
    };

    it('activa una cuenta inactiva: cambia estado, registra cambio, commitea y audita', async () => {
      userRepository.findAdminTarget.mockResolvedValue({ ...baseUser, isActive: false });

      const result = await service.activate('u1', AUDIT_CTX);

      expect(userRepository.setActiveStatus).toHaveBeenCalledWith('u1', true);
      expect(KycSharedUtil.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ changeType: 'account_status', previousValue: 'inactive', newValue: 'active' })
      );
      expect(txn.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PERSON_ACTIVATED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId }));
      expect(result).toEqual({ dto: 'ToggleUserStatusDTO', action: 'activate' });

      await flushMacrotasks();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'ACCOUNT_ACTIVATED' }));
    });

    it('desactiva una cuenta activa y audita PERSON_DEACTIVATED', async () => {
      userRepository.findAdminTarget.mockResolvedValue({ ...baseUser, isActive: true });

      const result = await service.deactivate('u1', AUDIT_CTX);

      expect(userRepository.setActiveStatus).toHaveBeenCalledWith('u1', false);
      expect(logAudit).toHaveBeenCalledWith('PERSON_DEACTIVATED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId }));
      expect(result).toEqual({ dto: 'ToggleUserStatusDTO', action: 'deactivate' });
    });

    it('lanza 404 y rollback si el usuario no existe', async () => {
      userRepository.findAdminTarget.mockResolvedValue(null);
      await expect(service.activate('u1', AUDIT_CTX)).rejects.toThrow('Usuario no encontrado');
      expect(txn.rollback).toHaveBeenCalled();
    });

    it('lanza 409 si la cuenta está eliminada', async () => {
      userRepository.findAdminTarget.mockResolvedValue({ ...baseUser, deletedAt: new Date() });
      await expect(service.activate('u1', AUDIT_CTX)).rejects.toThrow(/eliminada/);
      expect(txn.rollback).toHaveBeenCalled();
    });

    it('lanza 400 si ya está en el estado solicitado', async () => {
      userRepository.findAdminTarget.mockResolvedValue({ ...baseUser, isActive: true });
      await expect(service.activate('u1', AUDIT_CTX)).rejects.toThrow(/ya está activo/);
      expect(txn.rollback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // RESET PASSWORD
  // ============================================================

  describe('resetPassword', () => {
    const user = { userId: 'u1', deletedAt: null, person: { firstName: 'Juan', contact: { email: 'juan@test.com' } } };

    it('resetea la contraseña, registra cambio, commitea y audita', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);

      const result = await service.resetPassword('u1', AUDIT_CTX);

      expect(userRepository.updatePassword).toHaveBeenCalledWith('u1', 'TempPass123!');
      expect(KycSharedUtil.logChange).toHaveBeenCalledWith(expect.objectContaining({ changeType: 'password' }));
      expect(logAudit).toHaveBeenCalledWith('PERSON_PASSWORD_RESET', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId }));
      expect(result).toEqual({ dto: 'ResetPasswordDTO', id: 'u1' });

      await flushMacrotasks();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'PASSWORD_RESET_ADMIN' }));
    });

    it('lanza 404 y rollback si el usuario no existe', async () => {
      userRepository.findAdminTarget.mockResolvedValue(null);
      await expect(service.resetPassword('u1', AUDIT_CTX)).rejects.toThrow('Usuario no encontrado');
      expect(txn.rollback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // CAMBIAR EMAIL
  // ============================================================

  describe('changeEmail', () => {
    const user = {
      userId: 'u1',
      deletedAt: null,
      person: { personId: 'p1', firstName: 'Juan', contact: { personContactId: 'pc1', email: 'old@test.com' } }
    };

    it('cambia el email vía ProfileHelper, commitea, audita y notifica', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      ProfileHelper.updateEmailLogic.mockResolvedValue({ oldEmail: 'old@test.com', newEmail: 'new@test.com' });

      const result = await service.changeEmail('u1', 'new@test.com', AUDIT_CTX);

      expect(ProfileHelper.updateEmailLogic).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', personId: 'p1', newEmail: 'new@test.com', skipVerificationCheck: true })
      );
      expect(txn.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PERSON_EMAIL_CHANGED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId, details: { before: { email: 'old@test.com' }, after: { email: 'new@test.com' } } })
      );
      expect(result).toEqual({ dto: 'ChangeEmailDTO', oldE: 'old@test.com', newE: 'new@test.com' });

      await flushMacrotasks();
      expect(notifier.notifyEmail).toHaveBeenCalledWith(expect.objectContaining({ type: 'EMAIL_CHANGED_OLD' }));
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'EMAIL_CHANGED_NEW' }));
    });

    it('lanza 404 y rollback si el usuario no existe', async () => {
      userRepository.findAdminTarget.mockResolvedValue(null);
      await expect(service.changeEmail('u1', 'new@test.com', AUDIT_CTX)).rejects.toThrow('Usuario no encontrado');
      expect(txn.rollback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // CAMBIAR NATIONAL ID
  // ============================================================

  describe('changeNationalId', () => {
    const user = {
      userId: 'u1',
      deletedAt: null,
      person: { personId: 'p1', nationalId: 'old', firstName: 'Juan', contact: { email: 'juan@test.com' } },
      role: { roleId: 'rc1', name: 'cliente' }
    };

    it('cambia el national id, audita PERSON_NATIONAL_ID_CHANGED y notifica', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      ProfileHelper.updateNationalIdLogic.mockResolvedValue({ oldNationalId: 'old', newNationalId: 'new', unchanged: false });

      const result = await service.changeNationalId('u1', 'new', AUDIT_CTX);

      expect(txn.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PERSON_NATIONAL_ID_CHANGED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId, details: { before: { nationalId: 'old' }, after: { nationalId: 'new' } } })
      );
      expect(result).toEqual({ dto: 'ChangeNationalIdDTO', oldN: 'old', newN: 'new' });

      await flushMacrotasks();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'NATIONAL_ID_CHANGED' }));
    });

    it('es idempotente si no hubo cambio: commitea pero no audita ni notifica', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      ProfileHelper.updateNationalIdLogic.mockResolvedValue({ oldNationalId: 'same', newNationalId: 'same', unchanged: true });

      const result = await service.changeNationalId('u1', 'same', AUDIT_CTX);

      expect(txn.commit).toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalledWith('PERSON_NATIONAL_ID_CHANGED', expect.anything(), expect.anything(), expect.anything());
      expect(result).toEqual({ dto: 'ChangeNationalIdDTO', oldN: 'same', newN: 'same' });

      await flushMacrotasks();
      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // DESHABILITAR MFA
  // ============================================================

  describe('disableMFA', () => {
    const base = {
      userId: 'u1',
      deletedAt: null,
      person: { firstName: 'Juan', contact: { email: 'juan@test.com' } }
    };

    it('deshabilita TOTP y SMS, limpia secreto, audita y notifica', async () => {
      userRepository.findAdminTarget.mockResolvedValue({
        ...base,
        totpEnabled: true,
        smsMfaEnabled: true,
        preferredMfaMethod: 'totp'
      });

      const result = await service.disableMFA('u1', AUDIT_CTX);

      expect(userRepository.update).toHaveBeenCalledWith('u1', {
        preferredMfaMethod: 'none',
        totpEnabled: false,
        totpSecret: null,
        smsMfaEnabled: false
      });
      expect(KycSharedUtil.logChange).toHaveBeenCalledWith(expect.objectContaining({ changeType: 'mfa_status' }));
      expect(logAudit).toHaveBeenCalledWith('PERSON_MFA_DISABLED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId }));
      expect(result).toEqual({ dto: 'DisableMFADTO', id: 'u1' });

      await flushMacrotasks();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'RESET_MFA' }));
    });

    it('lanza 400 si el usuario no tiene MFA habilitado', async () => {
      userRepository.findAdminTarget.mockResolvedValue({ ...base, totpEnabled: false, smsMfaEnabled: false });
      await expect(service.disableMFA('u1', AUDIT_CTX)).rejects.toThrow(/no tiene MFA habilitado/);
      expect(txn.rollback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // CAMBIAR ROL
  // ============================================================

  describe('changeRole', () => {
    const user = {
      userId: 'u1',
      roleId: 'rc1',
      deletedAt: null,
      person: { firstName: 'Juan', contact: { email: 'juan@test.com' } },
      role: { roleId: 'rc1', name: 'CLIENTE', description: 'Cliente base' }
    };

    it('cambia el rol, registra cambio, commitea, audita y notifica', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      roleRepository.findById.mockResolvedValue({ roleId: 'rc2', name: 'CLIENTE_VERIFICADO', description: 'Verificado' });

      const result = await service.changeRole('u1', 'rc2', AUDIT_CTX);

      expect(userRepository.update).toHaveBeenCalledWith('u1', { roleId: 'rc2' });
      expect(logAudit).toHaveBeenCalledWith('PERSON_ROLE_CHANGED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId, details: { before: { role: 'CLIENTE' }, after: { role: 'CLIENTE_VERIFICADO' } } })
      );
      expect(result).toEqual({ dto: 'ChangeRoleDTO', oldR: 'CLIENTE', newR: 'CLIENTE_VERIFICADO' });

      await flushMacrotasks();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'ROL_CHANGE' }));
    });

    // Regresión (fase 4 TS): antes comparaba contra 'admin' en minúsculas (nunca coincidía) y este
    // endpoint podía cambiar el rol de un ADMIN o promover un cliente a interno.
    it('lanza 403 si la cuenta no es de cliente (p. ej. ADMIN)', async () => {
      userRepository.findAdminTarget.mockResolvedValue({ ...user, role: { roleId: 'ra', name: 'ADMIN' } });
      await expect(service.changeRole('u1', 'rc2', AUDIT_CTX)).rejects.toMatchObject({ statusCode: 403 });
      expect(userRepository.update).not.toHaveBeenCalled();
      expect(txn.rollback).toHaveBeenCalled();
    });

    it('lanza 400 si el rol destino no es de cliente (no promueve a interno)', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      roleRepository.findById.mockResolvedValue({ roleId: 'rs', name: 'SUPERADMIN' });
      await expect(service.changeRole('u1', 'rs', AUDIT_CTX)).rejects.toMatchObject({ statusCode: 400 });
      expect(userRepository.update).not.toHaveBeenCalled();
      expect(txn.rollback).toHaveBeenCalled();
    });

    it('lanza 404 si el rol destino no existe', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      roleRepository.findById.mockResolvedValue(null);
      await expect(service.changeRole('u1', 'rZ', AUDIT_CTX)).rejects.toThrow('Rol no encontrado');
      expect(txn.rollback).toHaveBeenCalled();
    });

    it('lanza 400 si el usuario ya tiene el rol', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      roleRepository.findById.mockResolvedValue({ roleId: 'rc1', name: 'CLIENTE' });
      await expect(service.changeRole('u1', 'rc1', AUDIT_CTX)).rejects.toThrow(/ya tiene este rol/);
      expect(txn.rollback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // ELIMINAR CUENTA (doble aprobación)
  // ============================================================

  describe('deleteAccount', () => {
    beforeEach(() => {
      userRepository.findByUserId.mockResolvedValue({ passwordHash: 'hash' });
      userRepository.findAdminTarget.mockResolvedValue({ userId: 'u1', deletedAt: null, person: { personId: 'p1' } });
    });

    it('devuelve pending cuando la doble aprobación queda pendiente (no ejecuta la eliminación)', async () => {
      DualApprovalService.gate.mockResolvedValue({ pending: true, request: { id: 'req-1' } });
      const execSpy = jest.spyOn(service, 'executeDeleteAccount');

      const result = await service.deleteAccount('u1', 'pwd', AUDIT_CTX);

      expect(ProfileHelper.validateCurrentPassword).toHaveBeenCalledWith('hash', 'pwd');
      expect(DualApprovalService.gate).toHaveBeenCalledWith('CLIENT_ACCOUNT_DELETE', expect.objectContaining({ entityType: 'User', entityId: 'u1' }));
      expect(execSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ pending: true, approvalRequest: { id: 'req-1' } });
      execSpy.mockRestore();
    });

    it('ejecuta la eliminación inline cuando la doble aprobación no aplica', async () => {
      DualApprovalService.gate.mockResolvedValue({ pending: false });
      const execSpy = jest.spyOn(service, 'executeDeleteAccount').mockResolvedValue(null);

      const result = await service.deleteAccount('u1', 'pwd', AUDIT_CTX);

      expect(execSpy).toHaveBeenCalledWith('u1', AUDIT_CTX);
      expect(result).toBeNull();
      execSpy.mockRestore();
    });

    it('lanza 404 si el admin (maker) no existe', async () => {
      userRepository.findByUserId.mockResolvedValue(null);
      await expect(service.deleteAccount('u1', 'pwd', AUDIT_CTX)).rejects.toThrow('Administrador no encontrado');
    });

    it('lanza 404 si la cuenta objetivo no existe', async () => {
      userRepository.findAdminTarget.mockResolvedValue(null);
      await expect(service.deleteAccount('u1', 'pwd', AUDIT_CTX)).rejects.toThrow('Usuario no encontrado');
    });
  });

  describe('executeDeleteAccount', () => {
    const user = {
      userId: 'u1',
      username: 'user_x',
      person: {
        personId: 'p1',
        nationalId: 'nid',
        firstName: 'Juan',
        contact: { personContactId: 'pc1', email: 'juan@test.com' }
      }
    };

    it('ofusca la cuenta vía ProfileHelper, commitea, audita y notifica cuando hay email', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      ProfileHelper.deleteAccountLogic.mockResolvedValue({ deletedEmail: 'juan@test.com', firstName: 'Juan' });

      const result = await service.executeDeleteAccount('u1', AUDIT_CTX);

      expect(ProfileHelper.deleteAccountLogic).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', personId: 'p1', email: 'juan@test.com', changedByRole: 'admin' })
      );
      expect(txn.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PERSON_ACCOUNT_DELETED', expect.objectContaining({ actorId: AUDIT_CTX.adminUserId }));
      expect(result).toBeNull();

      await flushMacrotasks();
      expect(notifier.notifyEmail).toHaveBeenCalledWith(expect.objectContaining({ type: 'CUENTA_ELIMINADA' }));
    });

    it('hace rollback si falla la ofuscación', async () => {
      userRepository.findAdminTarget.mockResolvedValue(user);
      ProfileHelper.deleteAccountLogic.mockRejectedValue(new Error('boom'));

      await expect(service.executeDeleteAccount('u1', AUDIT_CTX)).rejects.toThrow('boom');
      expect(txn.rollback).toHaveBeenCalled();
    });
  });
});
