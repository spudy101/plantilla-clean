// tests/doubles/banners.doubles.ts
//
// Dobles en memoria de los puertos de banners, para los tests de los casos de uso.
import type { IdGenerator } from '../../src/shared/application/ports/id-generator.port';
import type {
  BannerCatalogRepository,
  StoredBannerCatalog
} from '../../src/modules/banners/application/ports/banner-catalog-repository.port';
import type { BannerImageFile, BannerImageStorage } from '../../src/modules/banners/application/ports/banner-image-storage.port';
import { BannerCatalog, type Banner } from '../../src/modules/banners/domain/banner-catalog';

export const banner = (over: Partial<Banner> = {}): Banner => ({
  id: 'b1',
  title: 'Título',
  text: 'Texto',
  tag: null,
  buttonRoute: null,
  buttonName: null,
  imageUrl: null,
  isActive: true,
  sortOrder: 1,
  ...over
});

/** Catálogo guardado en memoria dentro de una "configuración" con id `cfg-1` (o ninguna). */
export class InMemoryBannerCatalogs implements BannerCatalogRepository {
  reads = 0;
  constructor(public stored: StoredBannerCatalog | null = { configId: 'cfg-1', catalog: BannerCatalog.empty() }) {}

  static with(banners: Banner[]) {
    return new InMemoryBannerCatalogs({ configId: 'cfg-1', catalog: BannerCatalog.restore(banners) });
  }

  async findActive() {
    this.reads++;
    return this.stored;
  }

  async replace(configId: string, catalog: BannerCatalog) {
    if (!this.stored || this.stored.configId !== configId) {
      return null;
    }
    this.stored = { configId, catalog };
    return catalog;
  }
}

/** Almacenamiento en memoria: "gestiona" las URLs que empiezan con https://cdn.test/promotional/banners/. */
export class InMemoryBannerImages implements BannerImageStorage {
  readonly uploaded: BannerImageFile[] = [];
  readonly removed: string[] = [];
  failOn = new Set<string>();

  async upload(file: BannerImageFile) {
    this.uploaded.push(file);
    return {
      url: `https://cdn.test/promotional/banners/img-${this.uploaded.length}.png`,
      key: `promotional/banners/img-${this.uploaded.length}.png`
    };
  }

  async removeUnused(urls: readonly string[]) {
    const attempted = urls.filter(u => u.startsWith('https://cdn.test/promotional/banners/'));
    const ok = attempted.filter(u => !this.failOn.has(u));
    this.removed.push(...ok);
    return { attempted, deleted: ok.length };
  }
}

/** Ids predecibles: id-1, id-2, … */
export const sequentialIds = (): IdGenerator => {
  let n = 0;
  return { next: () => `id-${++n}` };
};
