import commonResponses from '../../../config/swagger/responses/common.responses';
import { jsonBody, toOpenApi, toParameters } from '../../../shared/validation/openapi';
import { ConsentTypeIdParams, GrantConsentsBody, RevokeConsentBody } from '../requests/legal.request';
import { ConsentGrantedSchema, MyConsentCatalogItemSchema } from '../responses/legal-components.response';

/**
 * ============================================================
 * USER CONSENT PATHS — CLIENT  (RF-ADM-04)
 * ============================================================
 * Módulo: /client/api/v1/records/legal/consents
 * Roles: CLIENT_ACCESS_ROLES
 *
 * Rutas:
 *   GET  /client/api/v1/records/legal/consents
 *   POST /client/api/v1/records/legal/consents/grant
 *   POST /client/api/v1/records/legal/consents/:consentTypeId/revoke
 *
 * Fundamento legal:
 *   Ley 1581/2012 — Protección de Datos Personales
 *   Decreto 1377/2013 — Reglamentación de consentimientos
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  MyConsentCatalogItem: toOpenApi(MyConsentCatalogItemSchema, 'output'),
  ConsentGrantInput: toOpenApi(GrantConsentsBody),
  ConsentGranted: toOpenApi(ConsentGrantedSchema, 'output'),
  ConsentRevokeInput: toOpenApi(RevokeConsentBody)
};

const paths = {
  '/client/api/v1/records/legal/consents': {
    get: {
      tags: ['Client — Consentimientos'],
      summary: 'Catálogo de consentimientos con estado del usuario',
      description:
        'Retorna TODOS los tipos de consentimiento activos del catálogo (scope `ONBOARDING`), ' +
        'cada uno anotado con el estado de otorgamiento del usuario autenticado (`granted`). ' +
        'Esto permite al cliente mostrar y activar consentimientos que el usuario aún no ha aceptado, ' +
        'no solo los ya otorgados. Cuando `granted = false`, los campos de otorgamiento ' +
        '(`userConsentId`, `privacyPolicy`, `grantedAt`) vienen en null e `isCurrent = false`. ' +
        'Criterio RF-ADM-04: el usuario puede consultar en su perfil todos los consentimientos.',
      operationId: 'clientGetMyConsents',
      security: [{ bearerAuth: [] }],
      responses: {
        200: commonResponses.ok(
          { type: 'array', items: { $ref: '#/components/schemas/MyConsentCatalogItem' } },
          'Consentimientos obtenidos exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden
      }
    }
  },

  '/client/api/v1/records/legal/consents/grant': {
    post: {
      tags: ['Client — Consentimientos'],
      summary: 'Otorgar consentimientos',
      description:
        'Registra la aceptación explícita de uno o varios consentimientos. ' +
        'Cada consentimiento queda registrado como un registro independiente con timestamp, IP y user-agent. ' +
        'Usado al momento del registro (RF-AUTH-01) y para re-aceptaciones tras actualización de política. ' +
        'Ley 1581/2012 — consentimiento previo, informado y expreso.',
      operationId: 'clientGrantConsents',
      security: [{ bearerAuth: [] }],
      requestBody: jsonBody('ConsentGrantInput'),
      responses: {
        201: commonResponses.created(
          { type: 'array', items: { $ref: '#/components/schemas/ConsentGranted' } },
          'Consentimientos registrados exitosamente.'
        ),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError
      }
    }
  },

  '/client/api/v1/records/legal/consents/{consentTypeId}/revoke': {
    post: {
      tags: ['Client — Consentimientos'],
      summary: 'Revocar consentimiento opcional',
      description:
        'Revoca un consentimiento opcional (is_revocable = true). ' +
        'Aplica para consentimientos opcionales como `COMUNICACIONES_COMERCIALES`. ' +
        'Los consentimientos obligatorios (`PRIVACY_POLICY`) no pueden ser revocados por esta vía. ' +
        'La revocación no afecta el acceso al servicio (Ley 1581/2012, criterio RF-ADM-04).',
      operationId: 'clientRevokeConsent',
      security: [{ bearerAuth: [] }],
      parameters: toParameters(ConsentTypeIdParams, 'path'),
      requestBody: jsonBody('ConsentRevokeInput', { required: false }),
      responses: {
        200: commonResponses.ok(null, 'Consentimiento revocado exitosamente.'),
        ...commonResponses.BadRequest,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.NotFound,
        ...commonResponses.ValidationError
      }
    }
  }
};

export default { paths, schemas };
