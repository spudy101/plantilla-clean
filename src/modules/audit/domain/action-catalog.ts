// Consultas sobre el catálogo de acciones auditables (en memoria, sin tabla): cuántas acciones usan cada
// categoría, riesgo y módulo, y la búsqueda filtrada y ordenada por el código de la acción.
import catalogModule from './catalog';

const { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_RISK_ORDER, AUDIT_MODULES } = catalogModule;

/** Una acción del catálogo: su código y su definición. */
export interface CatalogAction {
  action: string;
  description: string;
  category: string;
  risk: string;
  module: string | null;
}

export interface CatalogActionFilters {
  category?: string | null;
  risk?: string | null;
  module?: string | null;
  search?: string | null;
}

function countBy(field: 'category' | 'risk' | 'module'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const def of Object.values(AUDIT_ACTIONS)) {
    const value = (def as Partial<Record<typeof field, string>>)[field];
    if (value !== undefined) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }
  return counts;
}

/** Categorías con su cantidad de acciones, en orden alfabético (español). */
export function categoriesWithCounts(): Array<{ category: string; actionsCount: number }> {
  const counts = countBy('category');
  return Object.values(AUDIT_CATEGORIES)
    .map(category => ({ category, actionsCount: counts[category] ?? 0 }))
    .sort((a, b) => a.category.localeCompare(b.category, 'es'));
}

/** Niveles de riesgo con su cantidad de acciones, de menor a mayor severidad. */
export function risksWithCounts(): Array<{ risk: string; actionsCount: number }> {
  const counts = countBy('risk');
  return AUDIT_RISK_ORDER.map(risk => ({ risk, actionsCount: counts[risk] ?? 0 }));
}

/** Módulos de origen con su cantidad de acciones. */
export function modulesWithCounts(): Array<{ module: string; actionsCount: number }> {
  const counts = countBy('module');
  return Object.values(AUDIT_MODULES).map(module => ({ module, actionsCount: counts[module] ?? 0 }));
}

function matches(action: CatalogAction, { category, risk, module, search }: CatalogActionFilters): boolean {
  if (category && action.category !== category) {
    return false;
  }
  if (risk && action.risk !== risk) {
    return false;
  }
  if (module && action.module !== module) {
    return false;
  }
  const term = typeof search === 'string' ? search.trim().toLowerCase() : '';
  return !term || action.action.toLowerCase().includes(term) || action.description.toLowerCase().includes(term);
}

/** Acciones que cumplen los filtros (búsqueda en código o descripción, sin distinguir mayúsculas), ordenadas por código. */
export function searchActions(filters: CatalogActionFilters, order: 'ASC' | 'DESC'): CatalogAction[] {
  const all = Object.entries(AUDIT_ACTIONS).map(([action, def]) => ({
    action,
    description: def.description,
    category: def.category,
    risk: def.risk,
    module: (def as { module?: string }).module ?? null
  }));
  return all
    .filter(a => matches(a, filters))
    .sort((a, b) => (order === 'ASC' ? a.action.localeCompare(b.action) : b.action.localeCompare(a.action)));
}
