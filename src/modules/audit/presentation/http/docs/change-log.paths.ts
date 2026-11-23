import commonResponses from '../../../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../../../shared/presentation/validation/openapi';
import { ChangeLogSchema } from '../responses/audit-components.response';
import { ChangeLogListQuery } from '../requests/audit.request';

/**
 * ============================================================
 * CHANGE LOG PATHS — ADMIN  (RF-ADM-03)
 * ============================================================
 * Módulo: /admin/api/v1/records/audit/change-logs
 * Todos los endpoints requieren rol ADMIN, SUPER_ADMIN o AUDITOR_INTERNO (solo lectura).
 *
 * Rutas:
 *   GET /admin/api/v1/records/audit/change-logs/users
 */

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AdminChangeLogItem: toOpenApi(ChangeLogSchema, 'output')
};

const adminSecurity = [{ bearerAuth: [], idTokenAuth: [] }];

const paths = {
  '/admin/api/v1/records/audit/change-logs/users': {
    get: {
      tags: ['Admin - Auditoría / Bitácora de Cambios'],
      summary: 'Bitácora de cambios de usuarios',
      operationId: 'adminListUserChangeLogs',
      description: `Lista paginada de cambios realizados sobre cuentas de usuario.

Registra: cambios de contraseña, email, national_id, rol, estado de cuenta, MFA y eliminación de cuenta. Los valores sensibles como contraseñas aparecen enmascarados como \`"hidden"\`, y \`previousValue\`/\`newValue\` salen **enmascarados** cuando tienen forma de correo, documento o teléfono (RF-USR-01 CA-6).`,
      security: adminSecurity,
      parameters: toParameters(ChangeLogListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/AdminChangeLogItem' },
          'Bitácora de cambios de usuarios obtenida exitosamente'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.ValidationError,
        ...commonResponses.InternalServerError
      }
    }
  }
};

export default { paths, schemas };
