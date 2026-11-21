import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import { ConsentTypeIdParams, ConsentTypeListQuery, CreateConsentTypeBody, UpdateConsentTypeBody } from '../requests/legal.request';
import { ConsentTypeDetailSchema, ConsentTypeListItemSchema } from '../responses/legal.response';

/**
 * ============================================================
 * CONSENT TYPE PATHS — ADMIN  (RF-ADM-04)
 * ============================================================
 * Módulo: /admin/api/v1/records/legal/consent-types
 * Roles: ADMIN_ACCESS_ROLES
 *
 * Rutas:
 *   GET    /admin/api/v1/records/legal/consent-types
 *   POST   /admin/api/v1/records/legal/consent-types
 *   GET    /admin/api/v1/records/legal/consent-types/:consentTypeId
 *   PATCH  /admin/api/v1/records/legal/consent-types/:consentTypeId
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  ConsentTypeItem: toOpenApi(ConsentTypeListItemSchema, 'output'),
  ConsentTypeDetail: toOpenApi(ConsentTypeDetailSchema, 'output'),
  ConsentTypeCreateRequest: toOpenApi(CreateConsentTypeBody),
  ConsentTypeUpdateRequest: toOpenApi(UpdateConsentTypeBody)
};

const paths = {
  '/admin/api/v1/records/legal/consent-types': {
    get: {
      tags: ['Admin — Consentimientos'],
      summary: 'Listar tipos de consentimiento',
      description: 'Lista paginada del catálogo de tipos de consentimiento. Roles: ADMIN_ACCESS_ROLES.',
      operationId: 'adminListConsentTypes',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      parameters: toParameters(ConsentTypeListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/ConsentTypeItem' },
          'Tipos de consentimiento obtenidos exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    },
    post: {
      tags: ['Admin — Consentimientos'],
      summary: 'Crear tipo de consentimiento',
      description:
        'Crea un nuevo tipo de consentimiento en el catálogo. El código debe ser único en mayúsculas (solo letras y guiones bajos). Roles: ADMIN_ACCESS_ROLES.',
      operationId: 'adminCreateConsentType',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      requestBody: jsonBody('ConsentTypeCreateRequest'),
      responses: {
        201: commonResponses.created(
          { $ref: '#/components/schemas/ConsentTypeDetail' },
          'Tipo de consentimiento creado exitosamente.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.Conflict,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/legal/consent-types/{consentTypeId}': {
    get: {
      tags: ['Admin — Consentimientos'],
      summary: 'Detalle de tipo de consentimiento',
      operationId: 'adminGetConsentType',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      parameters: toParameters(ConsentTypeIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/ConsentTypeDetail' }),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.InternalServerError
      }
    },
    patch: {
      tags: ['Admin — Consentimientos'],
      summary: 'Actualizar tipo de consentimiento',
      description:
        'Permite cambiar nombre, descripción y estado activo/inactivo. El código y los flags isMandatory/isRevocable no son editables una vez creados. Roles: ADMIN_ACCESS_ROLES.',
      operationId: 'adminUpdateConsentType',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      parameters: toParameters(ConsentTypeIdParams, 'path'),
      requestBody: jsonBody('ConsentTypeUpdateRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/ConsentTypeDetail' }),
        ...commonResponses.BadRequest,
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
