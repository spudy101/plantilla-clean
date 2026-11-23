// Casos de uso del catálogo de acciones auditables (en memoria): categorías, riesgos y módulos con su conteo,
// y la búsqueda paginada de acciones. Son síncronos: la auditoría de la consulta no se espera.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { appliedFilters, pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import {
  categoriesWithCounts,
  modulesWithCounts,
  risksWithCounts,
  searchActions,
  type CatalogActionFilters
} from '../../domain/action-catalog';
import { ACTION_CATALOG_ENTITY } from './audit-entities';

export class GetAuditCategories {
  constructor(private readonly audit: AuditTrail) {}

  execute({ actorId }: { actorId: string }) {
    const data = categoriesWithCounts();
    void this.audit.record('AUDIT_ACTION_CATALOG_CATEGORIES_VIEWED', {
      actorId,
      details: { totalCategories: data.length },
      ...ACTION_CATALOG_ENTITY
    });
    return { data };
  }
}

export class GetAuditRisks {
  constructor(private readonly audit: AuditTrail) {}

  execute({ actorId }: { actorId: string }) {
    const data = risksWithCounts();
    void this.audit.record('AUDIT_ACTION_CATALOG_RISKS_VIEWED', { actorId, details: { totalRisks: data.length }, ...ACTION_CATALOG_ENTITY });
    return { data };
  }
}

export class GetAuditModules {
  constructor(private readonly audit: AuditTrail) {}

  execute({ actorId }: { actorId: string }) {
    const data = modulesWithCounts();
    void this.audit.record('AUDIT_ACTION_CATALOG_MODULES_VIEWED', { actorId, details: { totalModules: data.length }, ...ACTION_CATALOG_ENTITY });
    return { data };
  }
}

export class ListAuditActions {
  constructor(private readonly audit: AuditTrail) {}

  execute({ actorId, query }: { actorId: string; query: PageQuery & CatalogActionFilters }) {
    const page = pageRequest(query);
    const all = searchActions(query, page.order);
    const activeFilters = appliedFilters({ category: query.category, risk: query.risk, module: query.module, search: query.search });

    void this.audit.record('AUDIT_ACTION_CATALOG_ACTIONS_LISTED', {
      actorId,
      details: { totalItems: all.length, filters: Object.keys(activeFilters) },
      ...ACTION_CATALOG_ENTITY
    });

    return { data: all.slice(page.offset, page.offset + page.limit), metadata: pageMetadata(page, all.length, activeFilters) };
  }
}
