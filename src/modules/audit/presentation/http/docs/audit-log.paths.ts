import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import { AuditLogExportQuery, AuditLogIdParams, AuditLogListQuery } from '../requests/audit.request';
import { AuditLogDetailSchema, AuditLogSchema } from '../responses/audit-components.response';

/**
 * ============================================================
 * AUDIT LOG PATHS — ADMIN  (RF-ADM-03)
 * ============================================================
 * Módulo: /admin/api/v1/records/audit/audit-logs
 * Roles: SUPERADMIN, AUDITOR_INTERNO
 *
 * Rutas:
 *   GET  /admin/api/v1/records/audit/audit-logs
 *   GET  /admin/api/v1/records/audit/audit-logs/export
 *   GET  /admin/api/v1/records/audit/audit-logs/:auditLogId
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AuditLog: toOpenApi(AuditLogSchema, 'output'),
  AuditLogDetail: toOpenApi(AuditLogDetailSchema, 'output')
};

const paths = {
  '/admin/api/v1/records/audit/audit-logs': {
    get: {
      tags: ['Admin - Auditoría / Logs'],
      summary: 'Listar logs de auditoría (paginado)',
      operationId: 'adminListAuditLogs',
      description: `Lista paginada de todos los logs de auditoría del sistema.

**Acceso:** SUPERADMIN y AUDITOR_INTERNO (solo lectura).

Los logs son **append-only** (inmutables) — ningún rol puede modificarlos ni eliminarlos (Circular 052 SFC).`,
      parameters: toParameters(AuditLogListQuery, 'query'),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/AuditLog' }, 'Logs de auditoría obtenidos exitosamente.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/audit-logs/export': {
    get: {
      tags: ['Admin - Auditoría / Logs'],
      summary: 'Exportar logs de auditoría (CSV / XLSX)',
      operationId: 'adminExportAuditLogs',
      description: `Descarga un archivo con los logs de auditoría que coincidan con los filtros aplicados.

**Formatos:** \`csv\` (default) o \`xlsx\`.
**Límite:** 50 000 filas. Si se supera, la respuesta incluye el header \`X-Export-Truncated: true\`.

**Acceso:** SUPERADMIN y AUDITOR_INTERNO.`,
      parameters: toParameters(AuditLogExportQuery, 'query'),
      responses: {
        200: {
          description: 'Archivo de exportación generado exitosamente.',
          headers: {
            'Content-Disposition': { schema: { type: 'string', example: 'attachment; filename="audit-logs.csv"' } },
            'X-Export-Truncated': {
              schema: { type: 'string', enum: ['true'] },
              description: 'Presente solo si el resultado superó el límite de 50 000 filas.'
            }
          },
          content: {
            'text/csv': { schema: { type: 'string', format: 'binary' } },
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
              schema: { type: 'string', format: 'binary' }
            }
          }
        },
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/audit-logs/{auditLogId}': {
    get: {
      tags: ['Admin - Auditoría / Logs'],
      summary: 'Detalle de un log de auditoría',
      operationId: 'adminGetAuditLog',
      description:
        'Devuelve el detalle completo de un registro de auditoría, incluyendo el campo `details` (JSONB) con los datos específicos de la acción.',
      parameters: toParameters(AuditLogIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AuditLogDetail' }, 'Log de auditoría obtenido exitosamente.'),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
