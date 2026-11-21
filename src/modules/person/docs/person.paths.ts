// config/swagger/modules/admin/kyc/person/person.paths.ts

import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import {
  AdminDeleteAccountBody,
  ChangeEmailBody,
  ChangeNationalIdBody,
  ChangeRoleBody,
  CreatePersonBody,
  PersonListQuery,
  DeletedPersonListQuery,
  PersonUserIdParams
} from '../requests/person.request';
import {
  AdminEmailChangedSchema,
  AdminMfaDisabledSchema,
  AdminNationalIdChangedSchema,
  AdminPasswordResetSchema,
  AdminRoleChangedSchema,
  AdminUserCreatedSchema,
  AdminUserDetailSchema,
  AdminUserListItemSchema,
  AdminUserStatusSchema
} from '../responses/admin-person.response';

/**
 * ============================================================
 * PERSON PATHS — ADMIN
 * ============================================================
 * Módulo: /admin/api/v1/kyc/person
 * Todos los endpoints requieren rol ADMIN o SUPER_ADMIN.
 *
 * Rutas:
 *   GET    /admin/api/v1/kyc/person
 *   GET    /admin/api/v1/kyc/person/deleted
 *   GET    /admin/api/v1/kyc/person/:userId
 *   POST   /admin/api/v1/kyc/person
 *   PUT    /admin/api/v1/kyc/person/:userId/activate
 *   PUT    /admin/api/v1/kyc/person/:userId/deactivate
 *   PUT    /admin/api/v1/kyc/person/:userId/reset-password
 *   PUT    /admin/api/v1/kyc/person/:userId/disable-mfa
 *   PUT    /admin/api/v1/kyc/person/:userId/email
 *   PUT    /admin/api/v1/kyc/person/:userId/national-id
 *   PUT    /admin/api/v1/kyc/person/:userId/role
 *   DELETE /admin/api/v1/kyc/person/:userId/delete-account
 *
 * Nota de seguridad:
 *   national_id y email están cifrados con AES-256-GCM en BD.
 *   La ENTRADA (requestBody / query) viaja siempre completa; la SALIDA sale
 *   **enmascarada** (RF-USR-01 CA-6) — ver `shared/validation/pii-masking.doc.ts`.
 *   Las búsquedas por national_id/email se hacen via HMAC-SHA256 hash,
 *   no por texto libre.
 */

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AdminUserListItem: toOpenApi(AdminUserListItemSchema, 'output'),
  AdminUserDetail: toOpenApi(AdminUserDetailSchema, 'output'),
  AdminUserCreated: toOpenApi(AdminUserCreatedSchema, 'output'),
  AdminUserStatus: toOpenApi(AdminUserStatusSchema, 'output'),
  AdminPasswordReset: toOpenApi(AdminPasswordResetSchema, 'output'),
  AdminMfaDisabled: toOpenApi(AdminMfaDisabledSchema, 'output'),
  AdminEmailChanged: toOpenApi(AdminEmailChangedSchema, 'output'),
  AdminNationalIdChanged: toOpenApi(AdminNationalIdChangedSchema, 'output'),
  AdminRoleChanged: toOpenApi(AdminRoleChangedSchema, 'output'),
  AdminCreateUserRequest: toOpenApi(CreatePersonBody),
  AdminChangeEmailRequest: toOpenApi(ChangeEmailBody),
  AdminChangeNationalIdRequest: toOpenApi(ChangeNationalIdBody),
  AdminChangeRoleRequest: toOpenApi(ChangeRoleBody),
  AdminDeleteAccountRequest: toOpenApi(AdminDeleteAccountBody)
};

// ─── Parámetros comunes ────────────────────────────────────────

const adminSecurity = [{ bearerAuth: [], idTokenAuth: [] }];

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/admin/api/v1/kyc/person': {
    get: {
      tags: ['Admin - Personas'],
      summary: 'Listar clientes',
      operationId: 'adminListUsers',
      description: `Lista paginada de **clientes** (solo usuarios con rol \`CLIENTE\` o \`CLIENTE_VERIFICADO\`).
Nunca devuelve usuarios internos. La gestión de usuarios internos vive en \`/admin/api/v1/kyc/users\`.

**Búsqueda por texto libre (\`search\`):** aplica \`iLike\` sobre \`username\`, \`first_name\` y \`last_name\`. \`national_id\` y \`email\` están cifrados con AES-256-GCM y no son buscables con texto libre.

**Búsqueda exacta por \`nationalId\`:** debe enviarse el valor completo. Internamente se calcula el HMAC-SHA256 y se compara contra \`national_id_hash\` — no se realiza ningún descifrado durante la búsqueda.

**Filtro por \`roleId\`:** acepta un UUID o varios separados por coma (\`uuid1,uuid2\`). Se intersecta con los roles cliente: un \`roleId\` que no sea \`CLIENTE\`/\`CLIENTE_VERIFICADO\` se ignora y se devuelven todos los clientes.

**Filtro por \`userId\`:** UUID exacto del usuario (PK). Devuelve a lo sumo un resultado (y solo si es cliente). Combinable con el resto de filtros.`,
      security: adminSecurity,
      parameters: toParameters(PersonListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/AdminUserListItem' },
          'Lista de usuarios obtenida exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    },

    post: {
      tags: ['Admin - Personas'],
      summary: 'Crear usuario',
      operationId: 'adminCreateUser',
      description: `Crea un nuevo usuario: persona + contact + user en BD.

**Flujo interno:**
1. Valida unicidad de \`nationalId\` (vía HMAC-SHA256) y \`email\`.
2. Persiste persona, contact (email cifrado) y user en BD dentro de una transacción.

⚠️ La contraseña temporal se devuelve **solo en esta respuesta** — no se puede recuperar después.`,
      security: adminSecurity,
      requestBody: jsonBody('AdminCreateUserRequest'),
      responses: {
        201: commonResponses.created({ $ref: '#/components/schemas/AdminUserCreated' }, 'Usuario creado exitosamente'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/roles': {
    get: {
      tags: ['Admin - Personas'],
      summary: 'Catálogo de roles de cliente (para filtro del listado)',
      operationId: 'adminListClientRoleOptions',
      description: `Devuelve los roles de **cliente** (\`CLIENTE\` / \`CLIENTE_VERIFICADO\`) para poblar el filtro
por rol del listado de clientes — los mismos que acepta el filtro \`roleId\` de \`GET /person\`. Evita ofrecer
todos los roles del sistema en un listado que solo contiene clientes.`,
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          { type: 'array', items: { $ref: '#/components/schemas/RoleOption' } },
          'Roles de cliente obtenidos exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/deleted': {
    get: {
      tags: ['Admin - Personas'],
      summary: 'Listar clientes eliminados (histórico)',
      operationId: 'adminListDeletedUsers',
      description: `Lista paginada **read-only** de **clientes eliminados** (\`deletedAt != null\`), solo con rol \`CLIENTE\`/\`CLIENTE_VERIFICADO\`.

Estas cuentas fueron ofuscadas de forma irreversible (Ley 1581/2012) y son **intocables**: no se pueden reactivar, editar, cambiar de rol ni re-eliminar (toda operación de escritura responde **409**).

El listado normal (\`GET /person\`) **excluye** estas cuentas; este endpoint es exclusivamente para consulta histórica. La búsqueda por texto es limitada porque los datos están ofuscados.`,
      security: adminSecurity,
      parameters: toParameters(DeletedPersonListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/AdminUserListItem' },
          'Lista de clientes eliminados obtenida exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}': {
    get: {
      tags: ['Admin - Personas'],
      summary: 'Obtener detalle de usuario',
      operationId: 'adminGetUser',
      description: `Retorna el perfil completo del usuario: datos personales y contact (email/teléfonos descifrados).

Incluye en \`metadata\` el porcentaje de completitud del perfil KYC.`,
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminUserDetail' }, 'Detalle de usuario obtenido exitosamente'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/activate': {
    put: {
      tags: ['Admin - Personas'],
      summary: 'Activar usuario',
      operationId: 'adminActivateUser',
      description: 'Activa la cuenta de un usuario inactivo. Envía notificación al usuario afectado.',
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminUserStatus' }, 'Usuario activado exitosamente'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/deactivate': {
    put: {
      tags: ['Admin - Personas'],
      summary: 'Desactivar usuario',
      operationId: 'adminDeactivateUser',
      description: 'Desactiva la cuenta de un usuario activo. Envía notificación al usuario afectado.',
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminUserStatus' }, 'Usuario desactivado exitosamente'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/reset-password': {
    put: {
      tags: ['Admin - Personas'],
      summary: 'Resetear contraseña',
      operationId: 'adminResetUserPassword',
      description: `Genera una nueva contraseña temporal y la asigna al usuario en BD.

La contraseña temporal se envía al email del usuario. No se devuelve en la respuesta de la API por seguridad.`,
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminPasswordReset' }, 'Contraseña reseteada exitosamente'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/disable-mfa': {
    put: {
      tags: ['Admin - Personas'],
      summary: 'Deshabilitar MFA',
      operationId: 'adminDisableUserMFA',
      description: 'Deshabilita el TOTP/MFA del usuario en BD. Solo aplica si `totp_enabled = true`.',
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminMfaDisabled' }, 'MFA deshabilitado exitosamente'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/email': {
    put: {
      tags: ['Admin - Personas'],
      summary: 'Cambiar email',
      operationId: 'adminChangeUserEmail',
      description: `Cambia el email del usuario. Actualiza el cifrado AES-256-GCM y el HMAC-SHA256 en BD.

Notifica tanto al email anterior como al nuevo email.`,
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      requestBody: jsonBody('AdminChangeEmailRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminEmailChanged' }, 'Email actualizado exitosamente'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/national-id': {
    put: {
      tags: ['Admin - Personas'],
      summary: 'Cambiar national ID',
      operationId: 'adminChangeUserNationalId',
      description: `Cambia el \`national_id\` del usuario. Actualiza el cifrado AES-256-GCM y el HMAC-SHA256 en BD.

La validación de unicidad se hace contra el hash antes de actualizar.

**Idempotente:** si el \`newNationalId\` enviado es igual al actual, responde \`200\` con el dato vigente y **no** ejecuta cambio, auditoría, re-screening SARLAFT ni notificación (no devuelve error).`,
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      requestBody: jsonBody('AdminChangeNationalIdRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminNationalIdChanged' }, 'National ID actualizado exitosamente'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/role': {
    put: {
      tags: ['Admin - Personas'],
      summary: 'Cambiar rol',
      operationId: 'adminChangeUserRole',
      description:
        'Cambia el rol del usuario. No aplica a usuarios con rol `admin`. Notifica al usuario con descripción del nuevo rol.',
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      requestBody: jsonBody('AdminChangeRoleRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AdminRoleChanged' }, 'Rol actualizado exitosamente'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/kyc/person/{userId}/delete-account': {
    delete: {
      tags: ['Admin - Personas'],
      summary: 'Eliminar cuenta',
      operationId: 'adminDeleteUserAccount',
      description: `Elimina la cuenta del usuario: **ofusca** sus datos personales de forma irreversible (Ley 1581/2012), la desactiva y sella \`deletedAt\`.

Tras la eliminación la cuenta queda **intocable** (toda operación de escritura responde **409**) y solo visible en \`GET /person/deleted\`. Una cuenta ya eliminada no se puede re-eliminar (**409**).

⚠️ **Acción irreversible.** Requiere que el administrador confirme su **propia contraseña**. Se envía notificación al email del usuario antes de ofuscarlo.

> **Doble aprobación (maker-checker):** la eliminación queda **pendiente de una segunda aprobación**.
> El endpoint responde **202** con el \`ApprovalRequest\`; la cuenta NO se elimina hasta que un segundo
> aprobador (SUPERADMIN) lo resuelve.`,
      security: adminSecurity,
      parameters: toParameters(PersonUserIdParams, 'path'),
      requestBody: jsonBody('AdminDeleteAccountRequest'),
      responses: {
        200: commonResponses.ok({ type: 'object', nullable: true }, 'Cuenta eliminada exitosamente'),
        202: commonResponses.accepted(
          { $ref: '#/components/schemas/ApprovalRequest' },
          'Eliminación pendiente de segunda aprobación (doble aprobación global). La cuenta NO se elimina hasta que se resuelva.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
