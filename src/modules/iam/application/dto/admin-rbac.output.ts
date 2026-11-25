// Salidas del catálogo RBAC (para que el front oculte vistas) y de los overrides.
import type { RolePermissionOverride } from '../../domain/rbac';

// Construye el árbol de grupos para el front a partir del array plano de RBAC_MODULE_GROUPS.
// Un grupo con `parent` cuelga como subgrupo de su padre; sin `parent`, es top-level.
// Resultado: [{ key, label, description, modules, subgroups: [ ...misma forma... ] }].
// La jerarquía es solo de presentación (el menú del front); la resolución de permisos sigue leyendo
// los módulos planos, sin importar el anidamiento.
/** Grupo del catálogo RBAC (RBAC_MODULE_GROUPS). */
interface ModuleGroup {
  key: string;
  label: string;
  description?: string;
  /** { id, label, description } por módulo: se reenvían tal cual al front */
  modules: readonly unknown[];
  parent?: string;
}
interface GroupNode extends Omit<ModuleGroup, 'parent'> {
  subgroups: GroupNode[];
}

function _buildGroupTree(groups: readonly ModuleGroup[]): GroupNode[] {
  const nodeByKey = new Map<string, GroupNode>();
  // 1ª pasada: un nodo por grupo (con subgroups vacío), para poder colgar hijos en cualquier orden.
  for (const g of groups) {
    nodeByKey.set(g.key, { key: g.key, label: g.label, description: g.description, modules: g.modules, subgroups: [] });
  }
  // 2ª pasada: cada grupo va bajo su padre (si existe) o queda top-level.
  const roots: GroupNode[] = [];
  for (const g of groups) {
    const node = nodeByKey.get(g.key);
    if (!node) {
      continue;
    }
    const parent = g.parent ? nodeByKey.get(g.parent) : null;
    if (parent) {
      parent.subgroups.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function RbacCatalogDTO(catalog: { groups: readonly ModuleGroup[]; modules: readonly unknown[]; actions: readonly unknown[] }) {
  return {
    // árbol anidado para el front: top-level con `subgroups` (Integraciones→{Proveedores,API Logs},
    // Administración→{Roles,Usuarios,Doble Aprobación}). Cada nodo: { key, label, description, modules, subgroups }.
    groups: _buildGroupTree(catalog.groups),
    modules: catalog.modules,
    actions: catalog.actions
  };
}

function RoleMatrixDTO(matrix: Array<{ role: string; basePermissions: unknown; addedPermissions: unknown }>) {
  return matrix.map(entry => ({
    role: entry.role,
    basePermissions: entry.basePermissions, // inmutables — solo cambian con deploy
    addedPermissions: entry.addedPermissions // agregados en runtime por SUPERADMIN
  }));
}

function EffectivePermissionsDTO(roleName: string | null, permissions: Record<string, string[]>) {
  return {
    role: roleName,
    permissions
  };
}

function RolePermissionsListDTO(roleName: string, overrides: OverrideRow[]) {
  return {
    role: roleName,
    overrides: overrides.map(RolePermissionOverrideDTO)
  };
}

/** Override con quien lo otorgó (include grantedBy → person). */
type OverrideRow = RolePermissionOverride;

function RolePermissionOverrideDTO(override: OverrideRow) {
  const gb = override.grantedBy ?? null;
  return {
    rolePermissionId: override.rolePermissionOverrideId,
    roleName: override.roleName,
    moduleName: override.moduleName,
    action: override.action,
    grantedByUserId: override.grantedByUserId,
    grantedBy: gb
      ? {
          userId: gb.userId,
          username: gb.username,
          fullName: [gb.person?.firstName, gb.person?.lastName].filter(Boolean).join(' ') || null
        }
      : null,
    createdAt: override.createdAt
  };
}

export default {
  RbacCatalogDTO,
  RoleMatrixDTO,
  EffectivePermissionsDTO,
  RolePermissionsListDTO,
  RolePermissionOverrideDTO
};


/** Resultado de revocar un override. */
export interface PermissionRevoked {
  deleted: true;
  permissionId: string;
}
