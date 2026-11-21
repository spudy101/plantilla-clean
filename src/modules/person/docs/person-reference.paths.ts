import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import { CreateReferenceBody, ReferenceIdParams, UpdateReferenceBody } from '../requests/person.request';
import { PersonReferenceSchema } from '../responses/person-components.response';

/**
 * ============================================================
 * PERSON REFERENCES PATHS — CLIENT
 * ============================================================
 * Módulo: /client/api/v1/kyc/person/person-references
 * Todos los endpoints requieren autenticación (bearerAuth + idTokenAuth)
 *
 * Rutas:
 *   GET    /client/api/v1/kyc/person/person-references
 *   POST   /client/api/v1/kyc/person/person-references
 *   PUT    /client/api/v1/kyc/person/person-references/:referenceId
 *   DELETE /client/api/v1/kyc/person/person-references/:referenceId
 */

// ─── Schemas propios del módulo ───────────────────────────────

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  PersonReference: toOpenApi(PersonReferenceSchema, 'output'),
  CreatePersonReferenceRequest: toOpenApi(CreateReferenceBody),
  UpdatePersonReferenceRequest: toOpenApi(UpdateReferenceBody)
};

// ─── Params comunes ───────────────────────────────────────────

// ─── Paths ────────────────────────────────────────────────────

const paths = {
  // ── GET /kyc/person-references ────────────────────────────────
  '/client/api/v1/kyc/person/person-references': {
    get: {
      tags: ['Referencias Personales'],
      summary: 'Listar mis referencias',
      operationId: 'listPersonReferences',
      description: 'Retorna todas las referencias personales y familiares registradas por el usuario autenticado.',
      responses: {
        200: commonResponses.ok(
          { type: 'array', items: { $ref: '#/components/schemas/PersonReference' } },
          'Referencias obtenidas exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.InternalServerError
      }
    },

    post: {
      tags: ['Referencias Personales'],
      summary: 'Registrar referencia',
      operationId: 'createPersonReference',
      description: 'Crea una nueva referencia personal o familiar asociada al usuario autenticado.',
      requestBody: jsonBody('CreatePersonReferenceRequest'),
      responses: {
        // created(): el builder de 201 (ok() documentaba statusCode 200 e ignoraba el tercer argumento)
        201: commonResponses.created({ $ref: '#/components/schemas/PersonReference' }, 'Referencia registrada exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  },

  // ── PUT /kyc/person-references/:referenceId ───────────────────
  '/client/api/v1/kyc/person/person-references/{referenceId}': {
    put: {
      tags: ['Referencias Personales'],
      summary: 'Actualizar referencia',
      operationId: 'updatePersonReference',
      parameters: toParameters(ReferenceIdParams, 'path'),
      requestBody: jsonBody('UpdatePersonReferenceRequest'),
      responses: {
        200: commonResponses.ok({ $ref: '#/components/schemas/PersonReference' }, 'Referencia actualizada exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    },

    delete: {
      tags: ['Referencias Personales'],
      summary: 'Eliminar referencia',
      operationId: 'deletePersonReference',
      parameters: toParameters(ReferenceIdParams, 'path'),
      responses: {
        200: commonResponses.ok({ type: 'object', nullable: true }, 'Referencia eliminada exitosamente.'),
        ...commonResponses.NotFound,
        ...commonResponses.Unauthorized,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
