// Casos de uso: una entrada puntual de un catálogo, por id o por código. No se auditan: no los pide una persona sino
// otros módulos mientras validan lo que eligió (person, iam) o arman un envío (notification).
import type { CatalogCodeFinder, CatalogEntryFinder } from '../ports/catalog-reader.port';

export class FindCatalogEntry<T> {
  constructor(private readonly entries: CatalogEntryFinder<T>) {}

  execute(id: string): Promise<T | null> {
    return this.entries.findById(id);
  }
}

export class FindCatalogEntryByCode<T> {
  constructor(private readonly entries: CatalogCodeFinder<T>) {}

  execute(code: string): Promise<T | null> {
    return this.entries.findByCode(code);
  }
}
