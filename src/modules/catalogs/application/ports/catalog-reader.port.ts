// Puertos de lectura de los catálogos. Los define la aplicación con lo que necesita; los implementan los
// repositorios Prisma del módulo (infrastructure/persistence) y, para lo que es de otros módulos (roles,
// tipos de notificación, política de privacidad), los adaptadores de src/main/.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ActivePrivacyPolicy, DocumentType } from '../../domain/catalog-entries';

/** Filtros comunes de un listado de catálogo, más los propios de cada uno (countryId, themeId…). */
export type CatalogFilters = { isActive?: boolean } & Record<string, unknown>;

/** Una página de resultados y el total. */
export interface CatalogPage<T> {
  rows: T[];
  count: number;
}

/** Listado paginado de un catálogo, con búsqueda por texto. */
export interface CatalogReader<T> {
  list(filters: CatalogFilters, page: PageRequest, search?: string | null): Promise<CatalogPage<T>>;
}

/** Los tipos de documento que se ofrecen al cliente en el formulario. */
export interface ClientDocumentTypeReader {
  listVisibleToClient(): Promise<DocumentType[]>;
}

/** La política de privacidad vigente. */
export interface ActivePrivacyPolicyReader {
  findActive(): Promise<ActivePrivacyPolicy | null>;
}
