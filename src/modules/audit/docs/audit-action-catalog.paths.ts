import commonResponses from '../../../shared/presentation/openapi/common.responses';
import { toOpenApi, toParameters } from '../../../shared/presentation/validation/openapi';
import { AuditActionListQuery } from '../requests/audit.request';
import {
  AuditActionCatalogItemSchema,
  AuditActionCategorySchema,
  AuditActionModuleSchema,
  AuditActionRiskSchema
} from '../responses/admin-audit-action-catalog.response';

/**
 * ============================================================
 * AUDIT ACTION CATALOG PATHS — ADMIN  (RF-ADM-03)
 * ============================================================
 * Catálogo de solo lectura de las acciones de auditoría definidas en
 * modules/audit/catalog/. Fuente homologada para poblar filtros
 * en el front (categorías, riesgos, módulos, acciones).
 *
 * Módulo: /admin/api/v1/records/audit/audit-action-catalog
 * Roles: SUPERADMIN, ADMIN_PRODUCTOS, AUDITOR_INTERNO, OFICIAL_CUMPLIMIENTO
 *
 * Rutas:
 *   GET /admin/api/v1/records/audit/audit-action-catalog/categories
 *   GET /admin/api/v1/records/audit/audit-action-catalog/risks
 *   GET /admin/api/v1/records/audit/audit-action-catalog/modules
 *   GET /admin/api/v1/records/audit/audit-action-catalog/actions
 */

const adminSecurity = [{ bearerAuth: [], idTokenAuth: [] }];

// Generados desde los esquemas Zod de requests/ y responses/.
const schemas = {
  AuditActionCategory: toOpenApi(AuditActionCategorySchema, 'output'),
  AuditActionRisk: toOpenApi(AuditActionRiskSchema, 'output'),
  AuditActionModule: toOpenApi(AuditActionModuleSchema, 'output'),
  AuditActionCatalogItem: toOpenApi(AuditActionCatalogItemSchema, 'output')
};

const catalogAccessNote = `**Acceso:** SUPERADMIN, ADMIN_PRODUCTOS, AUDITOR_INTERNO y OFICIAL_CUMPLIMIENTO (solo lectura).

Catálogo homologado: los valores provienen de la fuente de verdad \`modules/audit/catalog/audit-catalog.ts\`, los mismos que clasifican los registros en \`audit_logs\`.`;

const paths = {
  '/admin/api/v1/records/audit/audit-action-catalog/categories': {
    get: {
      tags: ['Admin - Auditoría / Catálogo de acciones'],
      summary: 'Listar categorías de auditoría',
      operationId: 'adminListAuditActionCategories',
      description: `Devuelve todas las categorías de auditoría con la cantidad de acciones de cada una.\n\n${catalogAccessNote}`,
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          { type: 'array', items: { $ref: '#/components/schemas/AuditActionCategory' } },
          'Categorías de auditoría obtenidas exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/audit-action-catalog/risks': {
    get: {
      tags: ['Admin - Auditoría / Catálogo de acciones'],
      summary: 'Listar niveles de riesgo de auditoría',
      operationId: 'adminListAuditActionRisks',
      description: `Devuelve los niveles de riesgo (en orden ascendente de severidad) con la cantidad de acciones de cada uno.\n\n${catalogAccessNote}`,
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          { type: 'array', items: { $ref: '#/components/schemas/AuditActionRisk' } },
          'Niveles de riesgo de auditoría obtenidos exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/audit-action-catalog/modules': {
    get: {
      tags: ['Admin - Auditoría / Catálogo de acciones'],
      summary: 'Listar módulos de auditoría',
      operationId: 'adminListAuditActionModules',
      description: `Devuelve los módulos de origen (\`admin\`, \`client\`, \`system\`) con la cantidad de acciones de cada uno.\n\n${catalogAccessNote}`,
      security: adminSecurity,
      responses: {
        200: commonResponses.ok(
          { type: 'array', items: { $ref: '#/components/schemas/AuditActionModule' } },
          'Módulos de auditoría obtenidos exitosamente.'
        ),
        ...commonResponses.Unauthorized,
        ...commonResponses.Forbidden,
        ...commonResponses.InternalServerError
      }
    }
  },

  '/admin/api/v1/records/audit/audit-action-catalog/actions': {
    get: {
      tags: ['Admin - Auditoría / Catálogo de acciones'],
      summary: 'Listar acciones del catálogo (paginado)',
      operationId: 'adminListAuditActionCatalog',
      description: `Lista paginada de todas las acciones de auditoría, filtrable por categoría, riesgo, módulo y búsqueda de texto libre (\`search\`, sobre código y descripción).\n\n${catalogAccessNote}`,
      security: adminSecurity,
      parameters: toParameters(AuditActionListQuery, 'query'),
      responses: {
        200: commonResponses.paginated(
          { $ref: '#/components/schemas/AuditActionCatalogItem' },
          'Catálogo de acciones de auditoría obtenido exitosamente.'
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
