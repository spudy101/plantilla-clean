import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { multipartBody, toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import { CreatePrivacyPolicyBody, PrivacyPolicyIdParams, PrivacyPolicyListQuery } from '../requests/legal.request';
import { PrivacyPolicyDetailSchema, PrivacyPolicyItemSchema } from '../responses/privacy-policy-admin.response';

/**
 * ============================================================
 * PRIVACY POLICY PATHS — ADMIN
 * ============================================================
 * Módulo: /admin/api/v1/records/legal/privacy-policies
 * Todos los endpoints requieren rol ADMIN o SUPER_ADMIN.
 *
 * Rutas:
 *   GET  /admin/api/v1/records/legal/privacy-policies
 *   GET  /admin/api/v1/records/legal/privacy-policies/:privacyPolicyId
 *   POST /admin/api/v1/records/legal/privacy-policies
 *
 * Flujo de publicación:
 *   1. El admin sube el PDF de la nueva versión (multipart/form-data).
 *   2. El PDF se almacena en el bucket PÚBLICO de S3 con key predecible:
 *      legal/privacy-policy-v{version}.pdf  (ej: legal/privacy-policy-v1-1.pdf)
 *   3. Se invalida el caché de CloudFront para que el archivo sea visible de inmediato.
 *   4. Se crea el registro en BD con la URL pública de CloudFront.
 *      El repositorio desactiva automáticamente la versión anterior (is_active → false).
 *
 * Nota: el document_url es una URL PÚBLICA de CloudFront, no una presigned URL.
 * Solo se expone en el detalle y en la respuesta de creación — no en el listado.
 */

// ─── Schemas ──────────────────────────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AdminPrivacyPolicyItem: toOpenApi(PrivacyPolicyItemSchema, 'output'),
  AdminPrivacyPolicyDetail: toOpenApi(PrivacyPolicyDetailSchema, 'output')
};

// ─── Parámetros comunes ────────────────────────────────────────

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  '/admin/api/v1/records/legal/privacy-policies': {
    get: {
      tags: ['Admin - Política de Privacidad'],
      summary: 'Listar versiones de la política de privacidad',
      operationId: 'adminListPrivacyPolicies',
      description: `Lista paginada de todas las versiones de la política de privacidad.

El campo \`documentUrl\` **no** se incluye en el listado — solo en el detalle y en la respuesta de creación.

Filtros disponibles: \`search\` (busca en \`version\` y \`summary\`) e \`isActive\`.`,
      security: [{ bearerAuth: [], idTokenAuth: [] }],
      parameters: toParameters(PrivacyPolicyListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/AdminPrivacyPolicyItem' },
          'Versiones de política de privacidad obtenidas exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    },

    post: {
      tags: ['Admin - Política de Privacidad'],
      summary: 'Publicar nueva versión de la política',
      operationId: 'adminCreatePrivacyPolicyVersion',
      description: `Publica una nueva versión de la política de privacidad.

**Flujo interno:**
1. Valida que el número de versión no exista ya en BD.
2. Sube el PDF al bucket **público** de S3 con key predecible: \`legal/privacy-policy-v{version}.pdf\`.
3. Invalida el caché de CloudFront para visibilidad inmediata.
4. Crea el registro en BD y **desactiva automáticamente la versión anterior** (\`is_active → false\`).

⚠️ El número de versión no puede reutilizarse. Para corregir un PDF ya publicado se debe crear una nueva versión.`,
      security: [{ bearerAuth: [], idTokenAuth: [] }],
      requestBody: multipartBody(CreatePrivacyPolicyBody, { policyDocument: 'PDF de la política (máximo 20 MB).' }),
      responses: {
        201: commonResponses.created(
          { $ref: '#/components/schemas/AdminPrivacyPolicyDetail' },
          'Nueva versión de política de privacidad publicada exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.RateLimitExceeded,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/legal/privacy-policies/{privacyPolicyId}': {
    get: {
      tags: ['Admin - Política de Privacidad'],
      summary: 'Obtener detalle de una versión',
      operationId: 'adminGetPrivacyPolicyDetail',
      description: `Retorna el detalle completo de una versión de la política incluyendo \`documentUrl\`, la URL pública permanente de CloudFront donde se puede leer el PDF.

A diferencia de los documentos de usuario, esta URL **no expira** — es una URL pública de CloudFront, no una presigned URL.`,
      security: [{ bearerAuth: [], idTokenAuth: [] }],
      parameters: toParameters(PrivacyPolicyIdParams, 'path'),
      responses: {
        200: commonResponses.ok(
          { $ref: '#/components/schemas/AdminPrivacyPolicyDetail' },
          'Detalle de política de privacidad obtenido exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
