import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import { AdminUserConsentListQuery, ConsentHistoryQuery, UserIdParams } from '../requests/legal.request';
import { UserConsentSchema } from '../responses/legal.response';

/**
 * ============================================================
 * USER CONSENT AUDIT PATHS — ADMIN  (RF-ADM-04)
 * ============================================================
 * Módulo: /admin/api/v1/records/legal/user-consents
 * Roles: SUPERADMIN, AUDITOR_INTERNO
 *
 * Rutas:
 *   GET /admin/api/v1/records/legal/user-consents
 *   GET /admin/api/v1/records/legal/user-consents/users/:userId
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  UserConsentAuditItem: toOpenApi(UserConsentSchema, 'output')
};

const paths = {
  '/admin/api/v1/records/legal/user-consents': {
    get: {
      tags: ['Admin — Auditoría de Consentimientos'],
      summary: 'Listar consentimientos de usuarios',
      description:
        'Lista paginada de todos los registros de consentimiento con filtros. ' +
        'Permite auditar qué usuarios aceptaron o revocaron qué consentimientos y cuándo. ' +
        'Roles: SUPERADMIN, AUDITOR_INTERNO.',
      operationId: 'adminListUserConsents',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      parameters: toParameters(AdminUserConsentListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/UserConsentAuditItem' },
          'Consentimientos obtenidos exitosamente.'
        ),
        ...commonResponses.ValidationError,
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/legal/user-consents/users/{userId}': {
    get: {
      tags: ['Admin — Auditoría de Consentimientos'],
      summary: 'Historial de consentimientos de un usuario',
      description:
        'Retorna el historial completo de consentimientos de un usuario específico, ' +
        'incluyendo aceptaciones anteriores y revocaciones. ' +
        'Roles: SUPERADMIN, AUDITOR_INTERNO.',
      operationId: 'adminGetUserConsentHistory',
      security: [{ bearerAuth: [] }, { idTokenAuth: [] }],
      parameters: [...toParameters(UserIdParams, 'path'), ...toParameters(ConsentHistoryQuery, 'query')],
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/UserConsentAuditItem' },
          'Historial de consentimientos obtenido exitosamente.'
        ),
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
