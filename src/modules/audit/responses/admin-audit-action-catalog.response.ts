// DTOs del catálogo de acciones de auditoría — todas las keys en camelCase.
import { z } from '../../../shared/validation/z';
import catalog from '../catalog/audit-catalog';

type Counted<K extends string> = Record<K, string> & { actionsCount: number };

const CategoryDTO = (item: Counted<'category'>) => ({
  category: item.category,
  actionsCount: item.actionsCount
});

const RiskDTO = (item: Counted<'risk'>) => ({
  risk: item.risk,
  actionsCount: item.actionsCount
});

const ModuleDTO = (item: Counted<'module'>) => ({
  module: item.module,
  actionsCount: item.actionsCount
});

const ActionListDTO = (item: {
  action: string;
  description: string;
  category: string;
  risk: string;
  module?: string | null;
}) => ({
  action: item.action,
  description: item.description,
  category: item.category,
  risk: item.risk,
  module: item.module ?? null
});

export default { CategoryDTO, RiskDTO, ModuleDTO, ActionListDTO };

// ── Esquemas de salida (enums derivados del catálogo: nunca se desincronizan) ──
const values = (o: Record<string, string>) => Object.values(o) as [string, ...string[]];
const actionsCount = z.number().int().meta({ example: 51, description: 'Cantidad de acciones que lo usan.' });

export const AuditActionCategorySchema = z.object({ category: z.enum(values(catalog.AUDIT_CATEGORIES)), actionsCount });
export const AuditActionRiskSchema = z.object({ risk: z.enum(values(catalog.AUDIT_RISKS)), actionsCount });
export const AuditActionModuleSchema = z.object({ module: z.enum(values(catalog.AUDIT_MODULES)), actionsCount });
export const AuditActionCatalogItemSchema = z.object({
  action: z.string().meta({ example: 'PERSON_LIST_VIEWED' }),
  description: z.string(),
  category: z.enum(values(catalog.AUDIT_CATEGORIES)),
  risk: z.enum(values(catalog.AUDIT_RISKS)),
  module: z.enum(values(catalog.AUDIT_MODULES)).nullable().meta({ description: 'null cuando la acción no declara módulo.' })
});
