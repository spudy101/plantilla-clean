// Caso de uso: listar un catálogo (paginado, con búsqueda y filtros) y auditar la consulta.
//
// Todos los catálogos se listan igual, así que es UNA clase genérica: catalogs.module.ts crea una instancia
// por catálogo con su lector, su acción de auditoría y su forma de salida. Las rutas son públicas: se
// auditan para detectar scraping o reconocimiento previo a un ataque (actorId null si no hay sesión).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageMetadata, pageRequest, type PageQuery } from '../../../../shared/application/pagination';
import type { CatalogFilters, CatalogReader } from '../ports/catalog-reader.port';
import type { ListOutput } from '../dto/catalog.output';

export interface ListCatalogInput {
  /** Página, tamaño y orden ya validados. */
  page: PageQuery;
  search?: string;
  filters: CatalogFilters;
  actorId?: string | null;
}

export class ListCatalog<Entry, Output> {
  constructor(
    private readonly reader: CatalogReader<Entry>,
    private readonly audit: AuditTrail,
    private readonly auditAction: string,
    private readonly toOutput: (entry: Entry) => Output
  ) {}

  async execute({ page: query, search, filters, actorId = null }: ListCatalogInput): Promise<ListOutput<Output>> {
    const page = pageRequest(query);
    const { rows, count } = await this.reader.list(filters, page, search);

    await this.audit.record(this.auditAction, {
      actorId,
      details: { totalItems: count, page: page.page },
      entityType: 'Catalog',
      entityTable: null
    });

    return { data: rows.map(this.toOutput), metadata: pageMetadata(page, count, { search, ...filters }) };
  }
}
