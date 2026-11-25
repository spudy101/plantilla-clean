// Esquemas de salida (Zod) del catálogo RBAC y los overrides.
import { z } from '../../../../../shared/presentation/validation/z';
import { dateTime } from '../../../../../shared/presentation/validation/output';

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
