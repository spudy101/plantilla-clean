// tests/doubles/catalogs.doubles.ts
//
// Dobles en memoria de los puertos de catalogs, para los tests de los casos de uso.
import type { PageRequest } from '../../src/shared/application/pagination';
import type { KeyValueCache } from '../../src/shared/application/ports/key-value-cache.port';
import type {
  ActivePrivacyPolicyReader,
  CatalogFilters,
  CatalogReader,
  ClientDocumentTypeReader
} from '../../src/modules/catalogs/application/ports/catalog-reader.port';
import type { ActivePrivacyPolicy, DocumentType } from '../../src/modules/catalogs/domain/catalog-entries';

/** Catálogo en memoria: filtra por `isActive` y por los demás filtros (campo = valor), busca por `name`. */
export class InMemoryCatalog<T extends { name?: string; isActive?: boolean | null }> implements CatalogReader<T> {
  readonly calls: Array<{ filters: CatalogFilters; page: PageRequest; search?: string | null }> = [];

  constructor(private readonly entries: T[]) {}

  async list(filters: CatalogFilters, page: PageRequest, search?: string | null) {
    this.calls.push({ filters, page, search });
    const matches = this.entries.filter(
      entry =>
        Object.entries(filters).every(
          ([key, value]) => value === undefined || (entry as Record<string, unknown>)[key] === value
        ) &&
        (!search || (entry.name ?? '').toLowerCase().includes(search.toLowerCase()))
    );
    return { rows: matches.slice(page.offset, page.offset + page.limit), count: matches.length };
  }
}

export class InMemoryDocumentTypes implements ClientDocumentTypeReader {
  constructor(private readonly entries: DocumentType[]) {}
  async listVisibleToClient() {
    return this.entries.filter(d => d.isVisibleToClient && d.isActive);
  }
}

export class InMemoryPrivacyPolicies implements ActivePrivacyPolicyReader {
  reads = 0;
  constructor(private readonly active: ActivePrivacyPolicy | null) {}
  async findActive() {
    this.reads++;
    return this.active;
  }
}

/** Caché en memoria (Map) que recuerda con qué TTL se guardó cada clave. */
export class InMemoryCache implements KeyValueCache {
  readonly store = new Map<string, unknown>();
  readonly ttls = new Map<string, number | null | undefined>();
  get(key: string) {
    return this.store.get(key) ?? null;
  }
  set(key: string, value: unknown, ttl?: number | null) {
    this.store.set(key, value);
    this.ttls.set(key, ttl);
  }
  del(key: string) {
    this.store.delete(key);
  }
}
