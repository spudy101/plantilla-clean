// RBAC (RF-ADM-01): "¿este rol puede hacer esta acción en este módulo?".
//
// ─── Dos capas de permisos ────────────────────────────────────────────────────
//   1. MATRIZ BASE (código, inmutable) — ROLE_PERMISSIONS en shared/domain/constants/rbac.
//      Criterio #2: no editable en runtime. Solo cambia con un deploy.
//   2. OVERRIDES (runtime, editables por SUPERADMIN) — tabla role_permission_overrides.
//      Criterio #1: el SUPERADMIN define permisos adicionales por módulo. Los overrides SOLO AÑADEN permisos
//      sobre la base; nunca la reducen.
import rbacModule from '../../../shared/domain/constants/rbac';
import { IamInvalidInputError } from './errors';

const { RBAC_WILDCARD, RBAC_MODULES, RBAC_MODULE_GROUPS, RBAC_ACTIONS, ROLE_PERMISSIONS, RBAC_ROLES } = rbacModule;

/** Override de permiso: concede una acción extra sobre un módulo. */
export interface PermissionOverride {
  moduleName: string;
  action: string;
}

/** Un override guardado, con quién lo otorgó. */
export interface RolePermissionOverride extends PermissionOverride {
  rolePermissionOverrideId: string;
  roleName: string;
  grantedByUserId: string;
  createdAt: Date;
  grantedBy?: { userId: string; username: string; person: { firstName: string; lastName: string } | null } | null;
}

type ModulePermission = readonly string[] | string | undefined;

const MODULES = () => Object.values(RBAC_MODULES) as string[];
const ACTIONS = () => Object.values(RBAC_ACTIONS) as string[];

function moduleAllows(actions: ModulePermission, action: string): boolean {
  if (!actions) {
    return false;
  }
  return actions === RBAC_WILDCARD || actions.includes(action);
}

/** ¿Lo concede la matriz base (sin mirar overrides)? */
export function grantedByBase(roleName: string, moduleName: string, action: string): boolean {
  const basePerms = ROLE_PERMISSIONS[roleName];
  if (!basePerms) {
    return false;
  }
  if (basePerms === RBAC_WILDCARD) {
    return true;
  }
  return moduleAllows(basePerms[moduleName], action) || moduleAllows(basePerms[RBAC_WILDCARD], action);
}

/** El rol existe en la matriz base (un rol desconocido no tiene ningún permiso, ni por override). */
export function isKnownRole(roleName: string): boolean {
  return Boolean(ROLE_PERMISSIONS[roleName]);
}

function grantedByOverride(overrides: readonly PermissionOverride[], moduleName: string, action: string): boolean {
  return overrides.some(o => o.moduleName === moduleName && o.action === action);
}

/** Resolución con los overrides ya cargados. */
export function can(roleName: string, moduleName: string, action: string, overrides: readonly PermissionOverride[]): boolean {
  if (!isKnownRole(roleName)) {
    return false;
  }
  return grantedByBase(roleName, moduleName, action) || grantedByOverride(overrides, moduleName, action);
}

/** Permisos efectivos de un rol, normalizados a { [módulo]: [acciones] }. */
export function effectivePermissions(roleName: string, overrides: readonly PermissionOverride[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const moduleName of MODULES()) {
    const actions = ACTIONS().filter(action => can(roleName, moduleName, action, overrides));
    if (actions.length > 0) {
      result[moduleName] = actions;
    }
  }
  return result;
}

/**
 * Matriz de un rol diferenciando el origen: basePermissions (código, no editables) y addedPermissions (overrides
 * revocables). Un override ya cubierto por la base no se repite en added.
 */
export function roleMatrixEntry(roleName: string, overrides: readonly PermissionOverride[]) {
  const basePermissions: Record<string, string[]> = {};
  const addedPermissions: Record<string, string[]> = {};
  for (const moduleName of MODULES()) {
    const baseActions: string[] = [];
    const addedActions: string[] = [];
    for (const action of ACTIONS()) {
      if (grantedByBase(roleName, moduleName, action)) {
        baseActions.push(action);
      } else if (grantedByOverride(overrides, moduleName, action)) {
        addedActions.push(action);
      }
    }
    if (baseActions.length > 0) {
      basePermissions[moduleName] = baseActions;
    }
    if (addedActions.length > 0) {
      addedPermissions[moduleName] = addedActions;
    }
  }
  return { role: roleName, basePermissions, addedPermissions };
}

/** Catálogo para que el front pinte el árbol de permisos y bloquee vistas. */
export function permissionCatalog() {
  return { groups: RBAC_MODULE_GROUPS, modules: MODULES(), actions: ACTIONS() };
}

/** Los roles RBAC (los de la matriz). */
export function rbacRoleNames(): string[] {
  return Object.values(RBAC_ROLES);
}

export function assertRbacRole(roleName: string): void {
  if (!rbacRoleNames().includes(roleName)) {
    throw new IamInvalidInputError(`El rol '${roleName}' no es un rol RBAC válido`);
  }
}
