import commonResponses from '../../../config/swagger/responses/common.responses';
import { toOpenApi } from '../../../shared/validation/openapi';
import { UpdateSystemGlobalConfigBody } from '../requests/system-global-config.request';
import { IntegrationResilience, SystemGlobalConfig } from '../responses/system-global-config.response';

/**
 * ============================================================
 * SYSTEM GLOBAL CONFIG PATHS — ADMIN
 * ============================================================
 * Módulo: /admin/api/v1/core/system-config
 * Roles: GET → SUPERADMIN y AUDITOR_INTERNO; PATCH → solo SUPERADMIN
 *
 * Rutas:
 *   GET   /admin/api/v1/core/system-config
 *   PATCH /admin/api/v1/core/system-config
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  IntegrationResilience: toOpenApi(IntegrationResilience, 'output'),
  SystemGlobalConfig: toOpenApi(SystemGlobalConfig, 'output'),
  SystemGlobalConfigPatch: toOpenApi(UpdateSystemGlobalConfigBody)
};

const paths = {
  '/admin/api/v1/core/system-config': {
    get: {
      tags: ['Admin - Configuración Global'],
      summary: 'Obtener configuración global del sistema',
      operationId: 'adminGetSystemConfig',
      description: `Devuelve el registro activo de configuración global del sistema.

**Acceso:** SUPERADMIN y AUDITOR_INTERNO (solo lectura).`,
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/SystemGlobalConfig' },
          'Configuración global obtenida exitosamente.'
        ),
        404: { description: 'No existe configuración global activa. Contactar al equipo de infraestructura.' },
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    },

    patch: {
      tags: ['Admin - Configuración Global'],
      summary: 'Actualizar configuración global del sistema',
      operationId: 'adminUpdateSystemConfig',
      description: `Actualiza parcialmente la configuración global. Solo se modifican los campos enviados.

**Acceso:** Solo SUPERADMIN.

**Comportamiento especial:**
- \`configVersion\` se auto-incrementa en cada PATCH exitoso.
- \`auditRetentionHotYears\` define la ventana del caliente; el worker de purga de \`audit_logs\` la usa como corte.
- \`auditHotPurgeEnabled\` enciende/apaga esa purga (default \`false\`, destructiva). Con \`true\` el worker mensual borra de la BD los logs vencidos (la copia permanece en S3/frío).
- \`auditRetentionColdYears\` es informacional — el lifecycle de S3 es declarativo en la infraestructura.
- Esta acción genera una **alerta de auditoría** automática en el panel del Superadmin (\`SYSTEM_GLOBAL_CONFIG_UPDATED\`).`,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SystemGlobalConfigPatch' },
            example: {
              currency: 'CLP',
              auditRetentionHotYears: 7,
              auditRetentionColdYears: 10,
              auditHotPurgeEnabled: false,
              integrationResilience: {
                timeoutMs: 30000,
                maxRetries: 3,
                circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 }
              }
            }
          }
        }
      },
      responses: {
        200: commonResponses.ok(
          {
            allOf: [{ $ref: '#/components/schemas/SystemGlobalConfig' }],
            example: {
              configId: '7b1f2c3d-4e5a-6b7c-8d9e-0f1a2b3c4d5e',
              configVersion: 4,
              currency: 'CLP',
              auditRetentionHotYears: 7,
              auditRetentionColdYears: 10,
              auditHotPurgeEnabled: false,
              integrationResilience: {
                timeoutMs: 30000,
                maxRetries: 3,
                circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 }
              }
            }
          },
          'Configuración global actualizada exitosamente.'
        ),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
