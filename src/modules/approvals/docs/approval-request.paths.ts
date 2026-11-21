// config/swagger/modules/admin/core/approval-request.paths.ts
// Doble aprobación global (maker-checker / cuatro ojos).
//
// Módulo: /admin/api/v1/core/approval-requests
//   GET    /admin/api/v1/core/approval-requests           — listar solicitudes (filtros)
//   GET    /admin/api/v1/core/approval-requests/policy     — política: qué operaciones están gateadas
//   GET    /admin/api/v1/core/approval-requests/:id       — detalle (incluye payload propuesto)
//   POST   /admin/api/v1/core/approval-requests/:id/resolve — aprobar / rechazar (checker)
//
// El "estado doble aprobación" de cualquier módulo vive en `approval_requests`.
// Las operaciones gateadas (RBAC, roles, operaciones sobre umbral) responden 202
// con el ApprovalRequest cuando quedan pendientes.

import commonResponses from '../../../config/swagger/responses/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/validation/openapi';
import { ApprovalIdParams, ApprovalListQuery, ResolveApprovalBody } from '../requests/approval-request.request';
import { ApprovalPolicySchema, ApprovalRequestListItemSchema, ApprovalRequestSchema } from '../responses/approval-components.response';

const TAG = 'Admin — Doble Aprobación';

const adminSecurity = [{ bearerAuth: [], idTokenAuth: [] }];

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  ApprovalRequestListItem: toOpenApi(ApprovalRequestListItemSchema, 'output'),
  ApprovalRequest: toOpenApi(ApprovalRequestSchema, 'output'),
  ApprovalPolicy: toOpenApi(ApprovalPolicySchema, 'output'),
  ApprovalResolveRequest: toOpenApi(ResolveApprovalBody)
};

// ─── Parámetros ───────────────────────────────────────────────

// ─── Respuestas específicas ───────────────────────────────────

const resolveConflictResponse = {
  409: {
    description: 'La solicitud ya no está pendiente (aprobada, rechazada o expirada) y no puede re-resolverse.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'La solicitud ya está en estado "approved" y no puede re-resolverse' },
            code: { type: 'string', example: 'APPROVAL_REQUEST_NOT_PENDING' }
          }
        }
      }
    }
  }
};

const resolveForbiddenResponse = {
  403: {
    description:
      'Rol no autorizado para resolver esta operación, o el aprobador es el mismo que originó (segregación de funciones).',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            code: { type: 'string' }
          }
        },
        examples: {
          roleNotAllowed: {
            summary: 'Rol no autorizado',
            value: { message: 'Tu rol no está autorizado a resolver esta operación', code: 'DUAL_APPROVAL_ROLE_NOT_ALLOWED' }
          },
          sameAsMaker: {
            summary: 'Aprobador = maker',
            value: {
              message: 'El segundo aprobador no puede ser el mismo que originó la operación (segregación de funciones)',
              code: 'DUAL_APPROVAL_SAME_AS_MAKER'
            }
          }
        }
      }
    }
  }
};

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/admin/api/v1/core/approval-requests': {
    get: {
      tags: [TAG],
      summary: 'Listar solicitudes de doble aprobación',
      description: 'Lista paginada con filtros por `operationKey`, `status` y `entityType`. Requiere `APPROVALS` READ.',
      security: adminSecurity,
      parameters: toParameters(ApprovalListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/ApprovalRequestListItem' },
          'Solicitudes de aprobación obtenidas exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/core/approval-requests/policy': {
    get: {
      tags: [TAG],
      summary: 'Política de doble aprobación',
      description:
        'Devuelve qué operaciones están gateadas, sus roles aprobadores, condición (always/threshold) y umbral vigente. Requiere `APPROVALS` READ.',
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/ApprovalPolicy' },
          'Política de doble aprobación obtenida exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/core/approval-requests/{id}': {
    get: {
      tags: [TAG],
      summary: 'Detalle de una solicitud de aprobación',
      description: 'Incluye el `payload` propuesto y el `result` si ya fue aprobada. Requiere `APPROVALS` READ.',
      security: adminSecurity,
      parameters: toParameters(ApprovalIdParams, 'path'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/ApprovalRequest' },
          'Solicitud de aprobación obtenida exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/core/approval-requests/{id}/resolve': {
    post: {
      tags: [TAG],
      summary: 'Resolver (aprobar / rechazar) una solicitud de aprobación',
      description: `
Resolución del segundo funcionario (checker). Requiere \`APPROVALS\` UPDATE y, además, el service valida:

- **Rol aprobador** del registro de la operación (\`approverRoles\`) o un rol wildcard (SUPERADMIN, admin, ADMIN_PRODUCTOS).
- **Segregación de funciones:** el aprobador NO puede ser el mismo usuario que originó la operación (maker).
- La solicitud debe estar en estado \`pending\` (de lo contrario 409).

Al **aprobar** se invoca el handler registrado de la operación, que ejecuta la acción real
(ej. desactivar un recurso, cambiar un rol, activar una regla) y guarda el \`result\`.
Al **rechazar** se descarta la operación pendiente.

> Esta es la vía única de segunda aprobación para TODAS las operaciones gateadas.
      `.trim(),
      security: adminSecurity,
      parameters: toParameters(ApprovalIdParams, 'path'),
      requestBody: jsonBody('ApprovalResolveRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/ApprovalRequest' }, 'Solicitud resuelta exitosamente'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...resolveForbiddenResponse,
        ...commonResponses.NotFound,
        ...resolveConflictResponse,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  }
};

const tags = [{ name: TAG, description: 'Framework de doble aprobación (maker-checker): cola, política y resolución.' }];

export default { schemas, paths, tags };
