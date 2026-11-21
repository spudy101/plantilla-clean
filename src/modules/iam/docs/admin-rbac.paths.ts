// config/swagger/modules/admin/kyc/iam/admin-rbac.paths.ts

import commonResponses from '../../../config/swagger/responses/common.responses';
import { PermissionRevokedSchema } from '../responses/admin-rbac.response';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/validation/openapi';
import { GrantPermissionBody, PermissionIdParams, RoleNameParams } from '../requests/iam.request';
import {
  EffectivePermissionsSchema,
  RbacCatalogSchema,
  RoleMatrixEntrySchema,
  RolePermissionOverrideSchema,
  RolePermissionsListSchema
} from '../responses/admin-rbac.response';

/**
 * ============================================================
 * ADMIN RBAC PATHS — RF-ADM-01
 * ============================================================
 * Catálogo RBAC de solo lectura + gestión de permisos en runtime.
 *
 * Rutas montadas en: /admin/api/v1/kyc/iam/rbac
 *   GET    /admin/api/v1/kyc/iam/rbac/modules
 *   GET    /admin/api/v1/kyc/iam/rbac/roles
 *   GET    /admin/api/v1/kyc/iam/rbac/me
 *   GET    /admin/api/v1/kyc/iam/rbac/roles/:roleName/permissions
 *   POST   /admin/api/v1/kyc/iam/rbac/roles/:roleName/permissions
 *   DELETE /admin/api/v1/kyc/iam/rbac/roles/:roleName/permissions/:permissionId
 */

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  RbacModuleCatalog: toOpenApi(RbacCatalogSchema, 'output'),
  RbacRoleMatrixEntry: toOpenApi(RoleMatrixEntrySchema, 'output'),
  RbacEffectivePermissions: toOpenApi(EffectivePermissionsSchema, 'output'),
  RolePermissionOverride: toOpenApi(RolePermissionOverrideSchema, 'output'),
  RolePermissionsListResult: toOpenApi(RolePermissionsListSchema, 'output'),
  GrantPermissionRequest: toOpenApi(GrantPermissionBody),
  RolePermissionRevoked: toOpenApi(PermissionRevokedSchema, 'output')
};

// ─── Parámetros comunes ────────────────────────────────────────

const adminSecurity = [{ bearerAuth: [], idTokenAuth: [] }];

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/admin/api/v1/kyc/iam/rbac/modules': {
    get: {
      tags: ['Admin - RBAC'],
      summary: 'Catálogo de módulos y acciones RBAC',
      operationId: 'adminGetRbacCatalog',
      description: `Devuelve el catálogo completo de módulos RBAC y sus acciones disponibles (READ, CREATE, UPDATE, DELETE).

Requiere permiso **READ** sobre el módulo \`rolesPermissions\`.`,
      security: adminSecurity,
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/RbacModuleCatalog' }, 'Catálogo RBAC obtenido exitosamente'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/iam/rbac/roles': {
    get: {
      tags: ['Admin - RBAC'],
      summary: 'Matriz de roles con permisos efectivos',
      operationId: 'adminGetRoleMatrix',
      description: `Devuelve todos los roles internos con sus permisos separados por origen:

- **base_permissions** — definidos en el código fuente (inmutables, solo cambian con deploy). El front los muestra sin opción de editar.
- **added_permissions** — otorgados en runtime por el SUPERADMIN vía overrides en BD. El front los muestra con opción de revocar.

Requiere permiso **READ** sobre el módulo \`rolesPermissions\`.`,
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          {
            type: 'array',
            items: { $ref: '#/components/schemas/RbacRoleMatrixEntry' }
          },
          'Matriz de roles obtenida exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/iam/rbac/me': {
    get: {
      tags: ['Admin - RBAC'],
      summary: 'Permisos efectivos del usuario autenticado',
      operationId: 'adminGetMyPermissions',
      description:
        'Devuelve los permisos efectivos del usuario autenticado (permisos base + overrides activos en Redis/BD). Accesible por cualquier usuario autenticado del servidor admin.',
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/RbacEffectivePermissions' },
          'Permisos del usuario obtenidos exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/iam/rbac/roles/{roleName}/permissions': {
    get: {
      tags: ['Admin - RBAC'],
      summary: 'Listar overrides de un rol',
      operationId: 'adminListRolePermissionOverrides',
      description: `Lista todos los permisos adicionales (overrides) otorgados en runtime al rol indicado.

Los overrides complementan la matriz base definida en código. Requiere permiso **READ** sobre el módulo \`rolesPermissions\`.`,
      security: adminSecurity,
      parameters: toParameters(RoleNameParams, 'path'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/RolePermissionsListResult' },
          'Overrides del rol obtenidos exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    },

    post: {
      tags: ['Admin - RBAC'],
      summary: 'Otorgar permiso adicional a un rol',
      operationId: 'adminGrantRolePermission',
      description: `Otorga un permiso adicional (override) a un rol para un módulo y acción específicos.

- Solo el **SUPERADMIN** puede hacer esta operación (requiere permiso **CREATE** sobre \`rolesPermissions\`).
- Si el permiso ya existe, devuelve **409 Conflict**.
- Al otorgar, el caché Redis del rol se invalida inmediatamente.
- La acción queda registrada en \`logAudit\` con \`RBAC_PERMISSION_GRANTED\`.`,
      security: adminSecurity,
      parameters: toParameters(RoleNameParams, 'path'),
      requestBody: jsonBody('GrantPermissionRequest'),
      responses: {
        201: commonResponses.created({ $ref: '#/components/schemas/RolePermissionOverride' }, 'Permiso otorgado exitosamente'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/iam/rbac/roles/{roleName}/permissions/{permissionId}': {
    delete: {
      tags: ['Admin - RBAC'],
      summary: 'Revocar override de permiso de un rol',
      operationId: 'adminRevokeRolePermission',
      description: `Elimina un override de permiso previamente otorgado.

- Solo el **SUPERADMIN** puede hacer esta operación (requiere permiso **DELETE** sobre \`rolesPermissions\`).
- Al revocar, el caché Redis del rol se invalida inmediatamente.
- La acción queda registrada en \`logAudit\` con \`RBAC_PERMISSION_REVOKED\`.`,
      security: adminSecurity,
      parameters: [...toParameters(RoleNameParams, 'path'), ...toParameters(PermissionIdParams, 'path')],
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/RolePermissionRevoked' }, 'Permiso revocado exitosamente'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
