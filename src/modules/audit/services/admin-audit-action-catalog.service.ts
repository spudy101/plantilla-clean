import auditactionsModule from '../catalog';
const {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_RISK_ORDER,
  AUDIT_MODULES
} = auditactionsModule;
import adminAuditActionCatalogDtoModule from '../responses/admin-audit-action-catalog.response';
const { CategoryDTO, RiskDTO, ModuleDTO, ActionListDTO } = adminAuditActionCatalogDtoModule;
import audit from '../audit.service';
import { appliedFilters, pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { AuditActionListQuery } from '../requests/audit.request';

/** Acción del catálogo de auditoría (clave + definición). */
interface CatalogAction {
  action: string;
  description: string;
  category: string;
  risk: string;
  module?: string | null;
}

// Entidad lógica (catálogo en memoria, sin tabla) — para trazabilidad de auditoría.
const AUDIT_ENTITY = { entityType: 'AuditActionCatalog', entityTable: null };

class AdminAuditActionCatalogService {
  // GET /api/audit-action-catalog/categories
  getCategories(adminUserId: string) {
    const counts = _countBy('category');
    const data = Object.values(AUDIT_CATEGORIES)
      .map(category => ({ category, actionsCount: counts[category] ?? 0 }))
      .sort((a, b) => a.category.localeCompare(b.category, 'es'));

    void audit.record('AUDIT_ACTION_CATALOG_CATEGORIES_VIEWED', {
      actorId: adminUserId,
      details: { totalCategories: data.length },
      ...AUDIT_ENTITY
    });

    return { data: data.map(CategoryDTO) };
  }

  // GET /api/audit-action-catalog/risks
  getRisks(adminUserId: string) {
    const counts = _countBy('risk');
    const data = AUDIT_RISK_ORDER.map(risk => ({ risk, actionsCount: counts[risk] ?? 0 }));

    void audit.record('AUDIT_ACTION_CATALOG_RISKS_VIEWED', {
      actorId: adminUserId,
      details: { totalRisks: data.length },
      ...AUDIT_ENTITY
    });

    return { data: data.map(RiskDTO) };
  }

  // GET /api/audit-action-catalog/modules
  getModules(adminUserId: string) {
    const counts = _countBy('module');
    const data = Object.values(AUDIT_MODULES).map(module => ({ module, actionsCount: counts[module] ?? 0 }));

    void audit.record('AUDIT_ACTION_CATALOG_MODULES_VIEWED', {
      actorId: adminUserId,
      details: { totalModules: data.length },
      ...AUDIT_ENTITY
    });

    return { data: data.map(ModuleDTO) };
  }

  // GET /api/audit-action-catalog/actions?category=&risk=&module=&search=&page=&limit=&order=
  listActions(query: AuditActionListQuery, adminUserId: string) {
    const page = pageRequest(query);

    const all = _filterActions(_allActions(), query);
    all.sort((a, b) => (page.order === 'ASC' ? a.action.localeCompare(b.action) : b.action.localeCompare(a.action)));

    const totalItems = all.length;
    const pageItems = all.slice(page.offset, page.offset + page.limit);

    const activeFilters = appliedFilters({ category: query.category, risk: query.risk, module: query.module, search: query.search });

    void audit.record('AUDIT_ACTION_CATALOG_ACTIONS_LISTED', {
      actorId: adminUserId,
      details: { totalItems, filters: Object.keys(activeFilters) },
      ...AUDIT_ENTITY
    });

    return {
      data: pageItems.map(ActionListDTO),
      metadata: pageMetadata(page, totalItems, activeFilters)
    };
  }
}

function _allActions() {
  return Object.entries(AUDIT_ACTIONS).map(([action, def]) => ({ action, ...def }));
}

function _filterActions(actions: CatalogAction[], query: Record<string, unknown>) {
  const { category, risk, module: moduleFilter, search } = query;
  const term = typeof search === 'string' ? search.trim().toLowerCase() : '';
  return actions.filter(a => {
    if (category && a.category !== category) {
      return false;
    }
    if (risk && a.risk !== risk) {
      return false;
    }
    if (moduleFilter && a.module !== moduleFilter) {
      return false;
    }
    if (term && !_matchesSearch(a, term)) {
      return false;
    }
    return true;
  });
}

function _matchesSearch(action: CatalogAction, term: string) {
  const actionName = action.action?.toLowerCase() ?? '';
  const description = action.description?.toLowerCase() ?? '';
  return actionName.includes(term) || description.includes(term);
}

function _countBy(field: 'category' | 'risk' | 'module'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const def of Object.values(AUDIT_ACTIONS)) {
    const value = (def as Partial<Record<typeof field, string>>)[field];
    if (value === undefined) {
      continue;
    }
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export default Object.assign(new AdminAuditActionCatalogService(), { AdminAuditActionCatalogService });
