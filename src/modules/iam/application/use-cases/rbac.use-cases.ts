// Casos de uso del RBAC (RF-ADM-01): resolver permisos (lo usa la autorización de cada ruta), el catálogo de solo
// lectura para que el front oculte vistas y la gestión de overrides en runtime (solo SUPERADMIN, por la ruta).
//
// Los overrides de cada rol se cachean 60 s; al otorgar o revocar uno se invalida la caché para que el cambio surta
// efecto de inmediato.
import { IamConflictError, IamNotFoundError } from '../../domain/errors';
import {
  assertRbacRole,
  can,
  effectivePermissions,
  isKnownRole,
  grantedByBase,
  permissionCatalog,
  rbacRoleNames,
  roleMatrixEntry,
  type PermissionOverride
} from '../../domain/rbac';
import adminRbacDtoModule, { type PermissionRevoked } from '../dto/admin-rbac.output';
import type { IamDeps } from './iam-deps';

const { RbacCatalogDTO, RoleMatrixDTO, EffectivePermissionsDTO, RolePermissionsListDTO, RolePermissionOverrideDTO } = adminRbacDtoModule;

/** "¿Este rol puede hacer esta acción en este módulo?": primero la base (código) y, si no alcanza, los overrides. */
export class PermissionResolver {
  constructor(private readonly deps: Pick<IamDeps, 'overrides' | 'overrideCache'>) {}

  async can(roleName: string, moduleName: string, action: string): Promise<boolean> {
    if (!isKnownRole(roleName)) {
      return false;
    }
    if (grantedByBase(roleName, moduleName, action)) {
      return true;
    }
    return can(roleName, moduleName, action, await this.overridesOf(roleName));
  }

  async effectivePermissions(roleName: string) {
    return effectivePermissions(roleName, await this.overridesOf(roleName));
  }

  matrix(roleNames: readonly string[]) {
    return Promise.all(roleNames.map(async roleName => roleMatrixEntry(roleName, await this.overridesOf(roleName))));
  }

  invalidate(roleName: string) {
    return this.deps.overrideCache.invalidate(roleName);
  }

  /** De la caché o, si no está, de la base (y se guarda). */
  private async overridesOf(roleName: string): Promise<PermissionOverride[]> {
    const cached = await this.deps.overrideCache.get(roleName);
    if (cached !== null) {
      return cached;
    }
    const overrides = await this.deps.overrides.findLookupByRole(roleName);
    await this.deps.overrideCache.set(roleName, overrides);
    return overrides;
  }
}

type RbacDeps = Pick<IamDeps, 'overrides' | 'audit' | 'notifier' | 'logger' | 'policy'> & { permissions: PermissionResolver };

export class GetRbacCatalog {
  constructor(private readonly deps: Pick<IamDeps, 'audit'>) {}

  execute(userId: string) {
    void this.deps.audit.record('RBAC_CATALOG_VIEWED', { actorId: userId, entityType: 'RbacCatalog', entityTable: 'roles' });
    return RbacCatalogDTO(permissionCatalog());
  }
}

export class GetRoleMatrix {
  constructor(private readonly deps: Pick<RbacDeps, 'audit' | 'permissions'>) {}

  async execute(userId: string) {
    const roleNames = rbacRoleNames();
    await this.deps.audit.record('RBAC_ROLES_VIEWED', { actorId: userId, entityType: 'RbacRole', entityTable: 'roles' });
    return RoleMatrixDTO(await this.deps.permissions.matrix(roleNames));
  }
}

export class GetEffectivePermissions {
  constructor(private readonly deps: Pick<RbacDeps, 'audit' | 'permissions'>) {}

  async execute(roleName: string | null, userId: string) {
    await this.deps.audit.record('RBAC_EFFECTIVE_PERMISSIONS_VIEWED', {
      actorId: userId,
      details: { roleName },
      entityType: 'RbacRole',
      entityTable: 'roles'
    });
    // Sin rol en el token no hay permisos efectivos
    return EffectivePermissionsDTO(roleName, roleName ? await this.deps.permissions.effectivePermissions(roleName) : {});
  }
}

export class ListPermissionOverrides {
  constructor(private readonly deps: Pick<RbacDeps, 'overrides' | 'audit'>) {}

  async execute(roleName: string, userId: string) {
    assertRbacRole(roleName);
    const overrides = await this.deps.overrides.findByRole(roleName);
    await this.deps.audit.record('RBAC_ROLE_PERMISSIONS_VIEWED', {
      actorId: userId,
      details: { roleName },
      entityType: 'RbacRole',
      entityTable: 'role_permission_overrides'
    });
    return RolePermissionsListDTO(roleName, overrides);
  }
}

/** Un permiso adicional para un rol (RF-ADM-01 criterio #1). */
export class GrantPermission {
  constructor(private readonly deps: RbacDeps) {}

  async execute(roleName: string, moduleName: string, action: string, grantedByUserId: string) {
    const { overrides, permissions, audit, notifier, logger, policy } = this.deps;
    assertRbacRole(roleName);
    if (await overrides.exists(roleName, moduleName, action)) {
      throw new IamConflictError(`El rol '${roleName}' ya tiene el permiso '${action}' en '${moduleName}'`);
    }

    const override = await overrides.create({ roleName, moduleName, action, grantedByUserId });
    await permissions.invalidate(roleName);

    await audit.record('RBAC_PERMISSION_GRANTED', {
      actorId: grantedByUserId,
      details: { roleName, moduleName, action },
      entityId: override.rolePermissionOverrideId,
      entityType: 'RbacPermission',
      entityTable: 'role_permission_overrides'
    });

    setImmediate(() => {
      notifier
        .notify({
          type: 'IAM_RBAC_PERMISSION_GRANTED',
          userId: grantedByUserId,
          relatedEntity: { type: 'RolePermissionOverride', id: override.rolePermissionOverrideId },
          metadata: { roleName, moduleName, action, logoUrl: policy.notificationLogoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_RBAC_PERMISSION_GRANTED', { error: err.message }));
    });

    return RolePermissionOverrideDTO(override);
  }
}

export class RevokePermission {
  constructor(private readonly deps: RbacDeps) {}

  async execute(permissionId: string, adminUserId: string): Promise<PermissionRevoked> {
    const { overrides, permissions, audit, notifier, logger, policy } = this.deps;
    const override = await overrides.findById(permissionId);
    if (!override) {
      throw new IamNotFoundError('Permiso no encontrado');
    }

    await overrides.deleteById(permissionId);
    await permissions.invalidate(override.roleName);

    const { roleName, moduleName, action } = override;
    await audit.record('RBAC_PERMISSION_REVOKED', {
      actorId: adminUserId,
      details: { roleName, moduleName, action },
      entityId: permissionId,
      entityType: 'RbacPermission',
      entityTable: 'role_permission_overrides'
    });

    setImmediate(() => {
      notifier
        .notify({
          type: 'IAM_RBAC_PERMISSION_REVOKED',
          userId: adminUserId,
          relatedEntity: { type: 'RolePermissionOverride', id: permissionId },
          metadata: { roleName, moduleName, action, logoUrl: policy.notificationLogoUrl }
        })
        .catch(err => logger.warn('Error enviando IAM_RBAC_PERMISSION_REVOKED', { error: err.message }));
    });

    return { deleted: true, permissionId };
  }
}
