// RBAC: resolución de permisos (base + overrides con caché), catálogo, matriz y gestión de overrides.
import {
  GetEffectivePermissions,
  GetRbacCatalog,
  GetRoleMatrix,
  GrantPermission,
  ListPermissionOverrides,
  PermissionResolver,
  RevokePermission
} from './rbac.use-cases';
import { IamConflictError, IamInvalidInputError, IamNotFoundError } from '../../domain/errors';
import { iamWorld, settle, SUPER_ID } from '../../../../../tests/doubles/iam.doubles';

function setup() {
  const w = iamWorld();
  const permissions = new PermissionResolver(w);
  return { w, permissions, deps: { ...w, permissions } };
}

describe('PermissionResolver', () => {
  it('lo que da la base no consulta overrides', async () => {
    const { w, permissions } = setup();
    await expect(permissions.can('SUPERADMIN', 'internalUsers', 'delete')).resolves.toBe(true);
    await expect(permissions.can('ADMIN', 'systemConfig', 'update')).resolves.toBe(true);
    await expect(permissions.can('AUDITOR', 'globalLogs', 'read')).resolves.toBe(true);
    expect(w.overrides.lookups).toHaveLength(0);
  });

  it('un rol desconocido no tiene nada y tampoco consulta', async () => {
    const { w, permissions } = setup();
    await expect(permissions.can('ROOT', 'globalLogs', 'read')).resolves.toBe(false);
    expect(w.overrides.lookups).toHaveLength(0);
  });

  it('si la base no alcanza mira los overrides: lee la base una vez y después usa la caché', async () => {
    const { w, permissions } = setup();
    await w.overrides.create({ roleName: 'AUDITOR', moduleName: 'clientsList', action: 'update', grantedByUserId: SUPER_ID });
    await expect(permissions.can('AUDITOR', 'clientsList', 'update')).resolves.toBe(true);
    await expect(permissions.can('AUDITOR', 'clientsList', 'delete')).resolves.toBe(false);
    expect(w.overrides.lookups).toEqual(['AUDITOR']);
    expect(w.overrideCache.entries.get('AUDITOR')).toEqual([{ moduleName: 'clientsList', action: 'update' }]);
  });

  it('CLIENTE no accede a nada del panel', async () => {
    const { permissions } = setup();
    await expect(permissions.can('CLIENTE', 'clientsList', 'read')).resolves.toBe(false);
    await expect(permissions.effectivePermissions('CLIENTE')).resolves.toEqual({});
  });
});

describe('lecturas', () => {
  it('el catálogo arma el árbol de grupos y audita', async () => {
    const { w } = setup();
    const catalog = new GetRbacCatalog(w).execute(SUPER_ID);
    await settle();
    expect(catalog.actions).toEqual(['create', 'read', 'update', 'delete']);
    expect(catalog.groups.some(g => g.subgroups.length > 0)).toBe(true);
    expect(w.audit.actions()).toEqual(['RBAC_CATALOG_VIEWED']);
  });

  it('la matriz trae los cuatro roles separando base y agregados', async () => {
    const { w, deps } = setup();
    await w.overrides.create({ roleName: 'AUDITOR', moduleName: 'clientsList', action: 'update', grantedByUserId: SUPER_ID });
    const matrix = await new GetRoleMatrix(deps).execute(SUPER_ID);
    expect(matrix.map(m => m.role)).toEqual(['SUPERADMIN', 'ADMIN', 'AUDITOR', 'CLIENTE']);
    expect(matrix[2]!.addedPermissions).toEqual({ clientsList: ['update'] });
    expect(w.audit.actions()).toEqual(['RBAC_ROLES_VIEWED']);
  });

  it('permisos efectivos del rol del token; sin rol, ninguno', async () => {
    const { w, deps } = setup();
    const auditor = await new GetEffectivePermissions(deps).execute('AUDITOR', SUPER_ID);
    expect(auditor.role).toBe('AUDITOR');
    expect(auditor.permissions.globalLogs).toEqual(['read']);
    await expect(new GetEffectivePermissions(deps).execute(null, SUPER_ID)).resolves.toEqual({ role: null, permissions: {} });
    expect(w.audit.entries.map(e => e.details)).toEqual([{ roleName: 'AUDITOR' }, { roleName: null }]);
  });

  it('los overrides de un rol válido; uno inválido es 400', async () => {
    const { w, deps } = setup();
    await w.overrides.create({ roleName: 'AUDITOR', moduleName: 'clientsList', action: 'update', grantedByUserId: SUPER_ID });
    const result = await new ListPermissionOverrides(deps).execute('AUDITOR', SUPER_ID);
    expect(result).toMatchObject({ role: 'AUDITOR', overrides: [{ rolePermissionId: 'ovr-1', moduleName: 'clientsList', action: 'update' }] });
    await expect(new ListPermissionOverrides(deps).execute('ROOT', SUPER_ID)).rejects.toThrow(IamInvalidInputError);
  });
});

describe('GrantPermission', () => {
  it('otorga, invalida la caché del rol, audita, avisa y devuelve el override', async () => {
    const { w, deps } = setup();
    w.overrideCache.entries.set('AUDITOR', []);
    const result = await new GrantPermission(deps).execute('AUDITOR', 'clientsList', 'update', SUPER_ID);
    await settle();
    expect(result).toMatchObject({ rolePermissionId: 'ovr-1', roleName: 'AUDITOR', moduleName: 'clientsList', action: 'update' });
    expect(w.overrideCache.invalidated).toEqual(['AUDITOR']);
    await expect(deps.permissions.can('AUDITOR', 'clientsList', 'update')).resolves.toBe(true);
    expect(w.audit.find('RBAC_PERMISSION_GRANTED')).toMatchObject({ entityId: 'ovr-1', details: { roleName: 'AUDITOR', moduleName: 'clientsList', action: 'update' } });
    expect(w.notifier.sent).toEqual([
      expect.objectContaining({ type: 'IAM_RBAC_PERMISSION_GRANTED', userId: SUPER_ID, relatedEntity: { type: 'RolePermissionOverride', id: 'ovr-1' } })
    ]);
  });

  it('un permiso repetido es 409; un rol inválido es 400 sin tocar el repositorio', async () => {
    const { w, deps } = setup();
    await new GrantPermission(deps).execute('AUDITOR', 'clientsList', 'update', SUPER_ID);
    await expect(new GrantPermission(deps).execute('AUDITOR', 'clientsList', 'update', SUPER_ID)).rejects.toThrow(
      new IamConflictError("El rol 'AUDITOR' ya tiene el permiso 'update' en 'clientsList'")
    );
    await expect(new GrantPermission(deps).execute('ROOT', 'clientsList', 'update', SUPER_ID)).rejects.toThrow(IamInvalidInputError);
    expect(w.overrides.overrides).toHaveLength(1);
  });
});

describe('RevokePermission', () => {
  it('revoca, invalida la caché del rol afectado, audita y avisa', async () => {
    const { w, deps } = setup();
    await w.overrides.create({ roleName: 'AUDITOR', moduleName: 'clientsList', action: 'update', grantedByUserId: SUPER_ID });
    await expect(new RevokePermission(deps).execute('ovr-1', SUPER_ID)).resolves.toEqual({ deleted: true, permissionId: 'ovr-1' });
    await settle();
    expect(w.overrides.overrides).toHaveLength(0);
    expect(w.overrideCache.invalidated).toEqual(['AUDITOR']);
    expect(w.audit.find('RBAC_PERMISSION_REVOKED')).toMatchObject({ entityId: 'ovr-1' });
    expect(w.notifier.sent.map(n => n.type)).toEqual(['IAM_RBAC_PERMISSION_REVOKED']);
  });

  it('uno inexistente es 404', async () => {
    const { deps } = setup();
    await expect(new RevokePermission(deps).execute('nada', SUPER_ID)).rejects.toThrow(new IamNotFoundError('Permiso no encontrado'));
  });
});
