import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { AlertsAcknowledgedSchema } from '../responses/audit-components.response';
import { jsonBody, toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import { AcknowledgeAlertsBody, AuditAlertIdParams, AuditAlertListQuery } from '../requests/audit.request';
import { AuditAlertSchema } from '../responses/audit-components.response';

/**
 * ============================================================
 * AUDIT ALERT PATHS — ADMIN  (RF-ADM-03)
 * ============================================================
 * Módulo: /admin/api/v1/records/audit/audit-alerts
 * Roles: GET → SUPERADMIN y AUDITOR_INTERNO (solo lectura); PATCH y POST → solo SUPERADMIN
 *
 * Rutas:
 *   GET   /admin/api/v1/records/audit/audit-alerts
 *   PATCH /admin/api/v1/records/audit/audit-alerts/:alertId/acknowledge
 *   POST  /admin/api/v1/records/audit/audit-alerts/acknowledge-bulk
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AuditAlert: toOpenApi(AuditAlertSchema, 'output'),
  AcknowledgeAlertsRequest: toOpenApi(AcknowledgeAlertsBody),
  AlertsAcknowledged: toOpenApi(AlertsAcknowledgedSchema, 'output')
};

const paths = {
  '/admin/api/v1/records/audit/audit-alerts': {
    get: {
      tags: ['Admin - Auditoría / Alertas'],
      summary: 'Listar alertas de auditoría',
      operationId: 'adminListAuditAlerts',
      description: `Lista paginada de alertas de auditoría visibles en el panel del Superadmin.

**Acceso:** SUPERADMIN y AUDITOR_INTERNO (solo lectura). Las acciones de reconocimiento (acknowledge) son exclusivas del SUPERADMIN.

El campo \`metadata.pendingCount\` indica el total de alertas pendientes sin reconocer — útil para mostrar un badge en el panel.`,
      parameters: toParameters(AuditAlertListQuery, 'query'),
      responses: {
        200: {
          description: 'Alertas obtenidas exitosamente.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  message: { type: 'string', example: 'Alertas de auditoría obtenidas exitosamente' },
                  data: { type: 'array', items: { $ref: '#/components/schemas/AuditAlert' } },
                  metadata: {
                    allOf: [
                      { $ref: '#/components/schemas/Metadata' },
                      {
                        type: 'object',
                        properties: {
                          pendingCount: {
                            type: 'integer',
                            example: 5,
                            description: 'Total de alertas pendientes sin reconocer en el sistema.'
                          }
                        }
                      }
                    ]
                  }
                }
              }
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

  '/admin/api/v1/records/audit/audit-alerts/{alertId}/acknowledge': {
    patch: {
      tags: ['Admin - Auditoría / Alertas'],
      summary: 'Reconocer una alerta',
      operationId: 'adminAcknowledgeAlert',
      description: `Marca una alerta como reconocida por el Superadmin autenticado.

Una alerta reconocida deja de aparecer en el contador de pendientes del panel.
El registro de quién y cuándo reconoció queda guardado en \`acknowledgedBy\` y \`acknowledgedAt\`.`,
      parameters: toParameters(AuditAlertIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AuditAlert' }, 'Alerta reconocida exitosamente.'),
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/audit-alerts/acknowledge-bulk': {
    post: {
      tags: ['Admin - Auditoría / Alertas'],
      summary: 'Reconocer múltiples alertas (bulk)',
      operationId: 'adminAcknowledgeAlertsBulk',
      description: `Reconoce un lote de alertas en una sola operación.

Útil para limpiar el panel cuando hay muchas alertas pendientes.
Solo afecta a alertas que aún no han sido reconocidas — las ya reconocidas son ignoradas sin error.

Devuelve \`acknowledged\` (cuántas se marcaron) y \`requested\` (cuántas se enviaron).`,
      requestBody: jsonBody('AcknowledgeAlertsRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/AlertsAcknowledged' }, 'Alertas reconocidas exitosamente.'),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
