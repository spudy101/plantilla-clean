// Esquemas de salida del catálogo de acciones de auditoría. Los enums salen de la taxonomía del catálogo:
// nunca se desincronizan.
import { z } from '../../../../../shared/presentation/validation/z';
import { AUDIT_TAXONOMY } from '../../../application/dto/audit-taxonomy.output';

const actionsCount = z.number().int().meta({ example: 51, description: 'Cantidad de acciones que lo usan.' });

export const AuditActionCategorySchema = z.object({ category: z.enum(AUDIT_TAXONOMY.categories), actionsCount });
export const AuditActionRiskSchema = z.object({ risk: z.enum(AUDIT_TAXONOMY.risks), actionsCount });
export const AuditActionModuleSchema = z.object({ module: z.enum(AUDIT_TAXONOMY.modules), actionsCount });
export const AuditActionCatalogItemSchema = z.object({
  action: z.string().meta({ example: 'PERSON_LIST_VIEWED' }),
  description: z.string(),
  category: z.enum(AUDIT_TAXONOMY.categories),
  risk: z.enum(AUDIT_TAXONOMY.risks),
  module: z.enum(AUDIT_TAXONOMY.modules).nullable().meta({ description: 'null cuando la acción no declara módulo.' })
});
