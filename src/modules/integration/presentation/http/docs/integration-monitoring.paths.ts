import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import { FallbackQuery } from '../requests/integration-monitoring.request';
import { FallbackEventSchema, ProvidersHealthSchema } from '../responses/integration-monitoring.response';

/**
 * INTEGRATION MONITORING PATHS — ADMIN
 * Estado de los proveedores externos (SES, S3, SNS, SMS) según su circuit breaker, e historial de caídas.
 * Solo lectura. Las métricas por llamada (% de éxito, latencia) están en CloudWatch (namespace ProviderCalls).
 *
 *   GET /admin/api/v1/integration/providers/health   (providers:READ)
 *   GET /admin/api/v1/integration/fallbacks          (providers:READ)
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  ProvidersHealth: toOpenApi(ProvidersHealthSchema, 'output'),
  ProviderFallbackEvent: toOpenApi(FallbackEventSchema, 'output')
};

const TAG = 'Admin - Integraciones externas';
const errors = { ...commonResponses.Unauthorized, ...commonResponses.Forbidden, ...commonResponses.InternalServerError };

const paths = {
  '/admin/api/v1/integration/providers/health': {
    get: {
      tags: [TAG],
      summary: 'Salud de los proveedores',
      operationId: 'adminProvidersHealth',
      description: 'Estado actual del circuit breaker de cada proveedor y cuántas caídas siguen abiertas.',
      responses: { 200: commonResponses.ok({ $ref: '#/components/schemas/ProvidersHealth' }), ...errors }
    }
  },
  '/admin/api/v1/integration/fallbacks': {
    get: {
      tags: [TAG],
      summary: 'Historial de fallbacks de proveedores (paginado)',
      operationId: 'adminProviderFallbacks',
      description: 'Ventanas en que el circuit breaker de un proveedor estuvo abierto, con su duración e impacto.',
      parameters: toParameters(FallbackQuery, 'query'),
      responses: {
        200: commonResponses.paginated({ $ref: '#/components/schemas/ProviderFallbackEvent' }),
        ...commonResponses.ValidationError,
        ...errors
      }
    }
  }
};

export default { paths, schemas };
