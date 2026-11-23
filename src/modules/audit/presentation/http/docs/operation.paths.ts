import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import { OperationIdParams, OperationListQuery } from '../requests/audit.request';
import { OperationSchema, OperationTimelineSchema } from '../responses/admin-operation.response';

/**
 * OPERATION PATHS — ADMIN
 * Traza de operaciones: una fila por petición HTTP, webhook, ciclo de worker o tarea de sistema.
 * RBAC: globalLogs (READ).
 *
 *   GET /admin/api/v1/records/audit/operations
 *   GET /admin/api/v1/records/audit/operations/{operationId}
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  Operation: toOpenApi(OperationSchema, 'output'),
  OperationTimeline: toOpenApi(OperationTimelineSchema, 'output')
};

const TAG = 'Admin - Auditoría / Operaciones';

const paths = {
  '/admin/api/v1/records/audit/operations': {
    get: {
      tags: [TAG],
      summary: 'Listar operaciones (paginado)',
      operationId: 'adminListOperations',
      parameters: toParameters(OperationListQuery, 'query'),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/Operation' }, 'Operaciones obtenidas exitosamente.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/operations/{operationId}': {
    get: {
      tags: [TAG],
      summary: 'Línea de tiempo de una operación',
      operationId: 'adminGetOperationTimeline',
      description: 'Une por correlationId la operación, sus operaciones hijas, sus hechos de negocio y sus llamadas externas.',
      parameters: toParameters(OperationIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/OperationTimeline' }, 'Línea de tiempo obtenida exitosamente.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
