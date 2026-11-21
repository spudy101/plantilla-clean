import { z } from '../../../shared/presentation/validation/z';
import { dateTime } from '../../../shared/presentation/validation/output';
import type { RolePermissionOverrideWithGrantor } from '../repositories/role-permission-override.repository';

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
type OverrideRow = Omit<RolePermissionOverrideWithGrantor, 'grantedBy'> & {
  grantedBy?: RolePermissionOverrideWithGrantor['grantedBy'] | null;
};

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

// ── Esquemas de salida ──
const RbacGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  modules: z.array(z.unknown()),
  subgroups: z.array(z.record(z.string(), z.unknown())).meta({ description: 'Subgrupos con esta misma forma (árbol).' })
});

export const RbacCatalogSchema = z
  .object({
    groups: z.array(RbacGroupSchema).meta({ description: 'Grupos de módulos en árbol (para pintar la pantalla de permisos).' }),
    modules: z.array(z.unknown()),
    actions: z.array(z.unknown())
  })
  .meta({ description: 'Catálogo RBAC: módulos, acciones y su agrupación.' });

const permissionMap = z.unknown().meta({ description: 'Permisos por módulo: { módulo: [acciones] }.' });

export const RoleMatrixEntrySchema = z.object({
  role: z.string().meta({ example: 'ADMIN_PRODUCTOS' }),
  basePermissions: permissionMap.meta({ description: 'Permisos fijos del rol (cambian solo con un deploy).' }),
  addedPermissions: permissionMap.meta({ description: 'Permisos agregados en caliente por un SUPERADMIN.' })
});

export const EffectivePermissionsSchema = z.object({
  role: z.string().nullable(),
  permissions: z.record(z.string(), z.array(z.string()))
});

export const RolePermissionOverrideSchema = z.object({
  rolePermissionId: z.uuid(),
  roleName: z.string(),
  moduleName: z.string(),
  action: z.string(),
  grantedByUserId: z.uuid().nullable(),
  grantedBy: z.object({ userId: z.uuid(), username: z.string().nullish(), fullName: z.string().nullable() }).nullable(),
  createdAt: dateTime()
});

export const RolePermissionsListSchema = z.object({ role: z.string(), overrides: z.array(RolePermissionOverrideSchema) });

// Resultado armado en el service (sin función DTO)
export const PermissionRevokedSchema = z.object({ deleted: z.literal(true), permissionId: z.uuid() });
export type PermissionRevoked = z.infer<typeof PermissionRevokedSchema>;
