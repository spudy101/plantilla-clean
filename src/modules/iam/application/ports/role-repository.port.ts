// Puerto: los roles (tabla roles) y los permisos extra por rol (role_permission_overrides).
import type { PageRequest } from '../../../../shared/application/pagination';
import type { PermissionOverride, RolePermissionOverride } from '../../domain/rbac';
import type { RoleRef } from '../../domain/user';

export interface Role extends RoleRef {
  isActive: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleRepository {
  list(filters: { isActive?: boolean } & Record<string, unknown>, page: PageRequest, search: string | null): Promise<{ rows: Role[]; count: number }>;
  findById(roleId: string): Promise<Role | null>;
  findByName(name: string): Promise<Role | null>;
  /** Los de `names`, opcionalmente sin los de `exclude`. */
  findByNames(names: readonly string[], options?: { exclude?: readonly string[] }): Promise<Role[]>;
}

export interface RolePermissionOverrideRepository {
  findById(rolePermissionOverrideId: string): Promise<RolePermissionOverride | null>;
  create(override: PermissionOverride & { roleName: string; grantedByUserId: string }): Promise<RolePermissionOverride>;
  /** Con quién los otorgó, por módulo + acción. */
  findByRole(roleName: string): Promise<RolePermissionOverride[]>;
  /** true si borró uno. */
  deleteById(rolePermissionOverrideId: string): Promise<boolean>;
  exists(roleName: string, moduleName: string, action: string): Promise<boolean>;
  /** Solo módulo + acción (la resolución de permisos). */
  findLookupByRole(roleName: string): Promise<PermissionOverride[]>;
}

/** Caché de los overrides de cada rol (60 s): se invalida al otorgar o revocar uno. */
export interface PermissionOverrideCache {
  get(roleName: string): Promise<PermissionOverride[] | null>;
  set(roleName: string, overrides: PermissionOverride[]): Promise<void>;
  invalidate(roleName: string): Promise<void>;
}
