// El contrato de los listados paginados, el mismo en todos los endpoints.
//
//   1. Entrada: el esquema del request declara `...pageQuery(sortable, { sortBy })` (shared/validation/fields.ts)
//      y sus filtros tipados. validate() deja la query ya parseada: page/limit con default, `sortBy` dentro
//      de los campos permitidos y `order` en mayúsculas. Un valor fuera de eso es un 422.
//   2. El service arma el pedido de página con `pageRequest(query)` (agrega el offset) y se lo pasa al
//      repositorio, que ordena por ese `sortBy` (PrismaRepository.paginationArgs).
//   3. La respuesta es `{ data, metadata: pageMetadata(page, total, filtros) }`: la metadata informa el orden y
//      los filtros que se **aplicaron**, no lo que el cliente pidió.
//
// Paginación por offset (page/limit) con total: la que necesitan las pantallas de administración (saltar a
// una página, mostrar el total). Si un listado de una tabla muy grande se vuelve lento, el camino es
// paginar ese listado por cursor (keyset), no cambiar este contrato para todos.

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export type SortOrder = 'ASC' | 'DESC';

/** page/limit/sortBy/order ya validados (la salida de `pageQuery`). */
export interface PageQuery<S extends string = string> {
  page: number;
  limit: number;
  sortBy: S;
  order: SortOrder;
}

/** Lo que recibe un repositorio para paginar: la página pedida más su offset. */
export interface PageRequest<S extends string = string> extends PageQuery<S> {
  offset: number;
}

export interface PageMetadata {
  pagination: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  sort: { field: string; order: SortOrder };
  /** Solo los filtros con valor; se omite si no hay ninguno. */
  filters?: Record<string, unknown>;
}

export function pageRequest<S extends string>({ page, limit, sortBy, order }: PageQuery<S>): PageRequest<S> {
  return { page, limit, sortBy, order, offset: (page - 1) * limit };
}

/** Filtros con valor (descarta undefined, null y ''). */
export function appliedFilters(filters: object = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

/** Metadata de la respuesta: paginación, el orden aplicado y los filtros aplicados. */
export function pageMetadata(page: PageQuery, totalItems: number, filters?: object): PageMetadata {
  const totalPages = Math.ceil(totalItems / page.limit);
  const applied = appliedFilters(filters);
  return {
    pagination: {
      currentPage: page.page,
      pageSize: page.limit,
      totalItems,
      totalPages,
      hasNextPage: page.page < totalPages,
      hasPreviousPage: page.page > 1
    },
    sort: { field: page.sortBy, order: page.order },
    ...(Object.keys(applied).length > 0 ? { filters: applied } : {})
  };
}

/** `{ data, metadata }` de un listado paginado. */
export function pageOf<T>(data: T[], page: PageQuery, totalItems: number, filters?: object) {
  return { data, metadata: pageMetadata(page, totalItems, filters) };
}
