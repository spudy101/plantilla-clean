// tests/unit/modules/admin/kyc/iam/services/admin-rbac.service.test.ts
//
// AdminRbacService — catálogo RBAC de solo lectura + gestión de overrides (permisos extra por rol)
// en runtime. Probamos: lectura del catálogo/matriz/permisos efectivos (delegan en RbacService y
// auditan); grant/revoke que escriben override, invalidan la caché del rol y notifican; y las ramas
// de validación (rol inválido, permiso duplicado, permiso inexistente). RbacService, repositorio de
// overrides, DTOs, notificaciones, constantes y logger se mockean. Las notificaciones salen en
// setImmediate → se vacía la cola de macrotareas antes de assertar.

jest.mock('./rbac.service', () => ({
  listCatalog: jest.fn(),
  getRoleMatrix: jest.fn(),
  getEffectivePermissions: jest.fn(),
  invalidateCache: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/presentation/http/app-error.util', () => ({
  notFound: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 404 }),
  badRequest: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 400 }),
  conflict: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 409 })
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../../../shared/infrastructure/config', () => ({
  RBAC_ROLES: { SUPER_ADMIN: 'super_admin', ADMIN: 'admin', AUDITOR: 'auditor' },
  notifications: { ses: { logoUrl: 'https://logo.test/x.png' } }
}));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../repositories/role-permission-override.repository', () => ({
  findByRole: jest.fn(),
  existsOverride: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  deleteById: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../responses/admin-rbac.response', () => ({
  RbacCatalogDTO: (c: Loose) => ({ dto: 'catalog', ...c }),
  RoleMatrixDTO: (m: Loose) => ({ dto: 'matrix', m }),
  EffectivePermissionsDTO: (role: Loose, perms: Loose) => ({ dto: 'effective', role, perms }),
  RolePermissionsListDTO: (role: Loose, overrides: Loose) => ({ dto: 'list', role, overrides }),
  RolePermissionOverrideDTO: (o: Loose) => ({ dto: 'override', ...o })
}));

import { mocked, Loose } from 'tests/helpers/mock';
import RbacServiceModule from './rbac.service';
const RbacService = mocked(RbacServiceModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import NotificationCreationServiceModule from '../../notification/notify';
const notifier = mocked(NotificationCreationServiceModule);
import overrideRepoModule from '../repositories/role-permission-override.repository';
const overrideRepo = mocked(overrideRepoModule);
import service from './admin-rbac.service';

const flush = () => new Promise(resolve => { setImmediate(resolve); });

describe('AdminRbacService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // CATÁLOGO (solo lectura)
  // ============================================================

  describe('getCatalog', () => {
    it('devuelve el catálogo del RbacService y audita', () => {
      RbacService.listCatalog.mockReturnValue({ groups: [], modules: [], actions: [] });

      const result = service.getCatalog('admin-1');

      expect(logAudit).toHaveBeenCalledWith('RBAC_CATALOG_VIEWED', expect.objectContaining({ actorId: 'admin-1' }));
      expect(result).toMatchObject({ dto: 'catalog' });
    });
  });

  describe('getRoles', () => {
    it('pide la matriz de todos los roles RBAC y audita', async () => {
      RbacService.getRoleMatrix.mockResolvedValue([{ role: 'admin' }]);

      const result = await service.getRoles('admin-1');

      expect(RbacService.getRoleMatrix).toHaveBeenCalledWith(['super_admin', 'admin', 'auditor']);
      expect(logAudit).toHaveBeenCalledWith('RBAC_ROLES_VIEWED', expect.objectContaining({ actorId: 'admin-1' }));
      expect(result).toMatchObject({ dto: 'matrix' });
    });
  });

  describe('getEffectivePermissions', () => {
    it('devuelve los permisos efectivos del rol y audita con el roleName', async () => {
      RbacService.getEffectivePermissions.mockResolvedValue(['users:read']);

      const result = await service.getEffectivePermissions('admin', 'admin-1');

      expect(logAudit).toHaveBeenCalledWith('RBAC_EFFECTIVE_PERMISSIONS_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { roleName: 'admin' } }));
      expect(result).toEqual({ dto: 'effective', role: 'admin', perms: ['users:read'] });
    });
  });

  // ============================================================
  // OVERRIDES
  // ============================================================

  describe('listOverrides', () => {
    it('lista los overrides de un rol válido y audita', async () => {
      overrideRepo.findByRole.mockResolvedValue([{ rolePermissionOverrideId: 'rp-1' }]);

      const result = await service.listOverrides('admin', 'admin-1');

      expect(overrideRepo.findByRole).toHaveBeenCalledWith('admin');
      expect(logAudit).toHaveBeenCalledWith('RBAC_ROLE_PERMISSIONS_VIEWED', expect.objectContaining({ actorId: 'admin-1', details: { roleName: 'admin' } }));
      expect(result).toMatchObject({ dto: 'list', role: 'admin' });
    });

    it('rechaza (400) un rol RBAC inválido', async () => {
      await expect(service.listOverrides('inexistente', 'admin-1')).rejects.toThrow(/no es un rol RBAC válido/);
      expect(overrideRepo.findByRole).not.toHaveBeenCalled();
    });
  });

  describe('grantPermission', () => {
    it('otorga el permiso, invalida caché, audita, notifica y devuelve el override', async () => {
      overrideRepo.existsOverride.mockResolvedValue(false);
      overrideRepo.create.mockResolvedValue({
        rolePermissionOverrideId: 'rp-9',
        roleName: 'admin',
        moduleName: 'users',
        action: 'delete'
      });

      const result = await service.grantPermission('admin', 'users', 'delete', 'admin-1');

      expect(overrideRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: 'admin', moduleName: 'users', action: 'delete', grantedByUserId: 'admin-1' })
      );
      expect(RbacService.invalidateCache).toHaveBeenCalledWith('admin');
      expect(logAudit).toHaveBeenCalledWith('RBAC_PERMISSION_GRANTED', expect.objectContaining({ actorId: 'admin-1', details: expect.objectContaining({ roleName: 'admin', moduleName: 'users', action: 'delete' }) })
      );
      expect(result).toMatchObject({ dto: 'override', rolePermissionOverrideId: 'rp-9' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'IAM_RBAC_PERMISSION_GRANTED' }));
    });

    it('rechaza (409) si el rol ya tiene ese permiso en el módulo', async () => {
      overrideRepo.existsOverride.mockResolvedValue(true);
      await expect(service.grantPermission('admin', 'users', 'delete', 'admin-1')).rejects.toThrow(/ya tiene el permiso/);
      expect(overrideRepo.create).not.toHaveBeenCalled();
    });

    it('rechaza (400) un rol inválido antes de tocar el repositorio', async () => {
      await expect(service.grantPermission('nope', 'users', 'delete', 'admin-1')).rejects.toThrow(/no es un rol RBAC válido/);
      expect(overrideRepo.existsOverride).not.toHaveBeenCalled();
    });
  });

  describe('revokePermission', () => {
    it('revoca el permiso, invalida la caché del rol afectado, audita y notifica', async () => {
      overrideRepo.findById.mockResolvedValue({
        rolePermissionOverrideId: 'rp-1',
        roleName: 'admin',
        moduleName: 'users',
        action: 'delete'
      });

      const result = await service.revokePermission('rp-1', 'admin-1');

      expect(overrideRepo.deleteById).toHaveBeenCalledWith('rp-1');
      expect(RbacService.invalidateCache).toHaveBeenCalledWith('admin');
      expect(logAudit).toHaveBeenCalledWith('RBAC_PERMISSION_REVOKED', expect.objectContaining({ actorId: 'admin-1', details: expect.objectContaining({ roleName: 'admin' }) }));
      expect(result).toEqual({ deleted: true, permissionId: 'rp-1' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'IAM_RBAC_PERMISSION_REVOKED' }));
    });

    it('lanza (404) si el permiso a revocar no existe', async () => {
      overrideRepo.findById.mockResolvedValue(null);
      await expect(service.revokePermission('rp-x', 'admin-1')).rejects.toThrow('Permiso no encontrado');
      expect(overrideRepo.deleteById).not.toHaveBeenCalled();
    });
  });
});
