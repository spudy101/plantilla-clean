// Agregado: el catálogo de banners promocionales (landing pública + app cliente).
//
// El administrador no edita banners sueltos: manda el catálogo COMPLETO y este reemplaza al anterior. Las
// reglas de ese reemplazo viven acá (TypeScript puro, sin base ni S3):
//   - un banner sin id es nuevo (se le asigna uno);
//   - lo que no se manda queda con su valor por defecto (activo, orden = posición en el arreglo);
//   - las imágenes que el catálogo viejo usaba y el nuevo ya no, quedan huérfanas (se pueden borrar);
//   - el público solo ve los activos, ordenados.

export interface Banner {
  id: string;
  title: string;
  text: string;
  tag: string | null;
  buttonRoute: string | null;
  buttonName: string | null;
  imageUrl: string | null;
  isActive: boolean;
  /** null en banners viejos sin orden: van primero. */
  sortOrder: number | null;
}

/** Un banner tal como lo manda el administrador: id y lo opcional pueden faltar. */
export interface BannerDraft {
  id?: string | null;
  title: string;
  text: string;
  tag?: string | null;
  buttonRoute?: string | null;
  buttonName?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
}

const byOrder = (a: Banner, b: Banner) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

export class BannerCatalog {
  private constructor(private readonly items: readonly Banner[]) {}

  static restore(banners: readonly Banner[]): BannerCatalog {
    return new BannerCatalog(banners.map(b => ({ ...b })));
  }

  static empty(): BannerCatalog {
    return new BannerCatalog([]);
  }

  /** El catálogo que reemplaza a este con lo que mandó el administrador. `newId` da el id de los nuevos. */
  static fromDrafts(drafts: readonly BannerDraft[], newId: () => string): BannerCatalog {
    return new BannerCatalog(
      drafts.map((draft, index) => ({
        id: draft.id ?? newId(),
        title: draft.title,
        text: draft.text,
        tag: draft.tag ?? null,
        buttonRoute: draft.buttonRoute ?? null,
        buttonName: draft.buttonName ?? null,
        imageUrl: draft.imageUrl ?? null,
        isActive: draft.isActive ?? true,
        sortOrder: draft.sortOrder ?? index + 1
      }))
    );
  }

  /** Todos los banners, en el orden configurado (vista del administrador). */
  sorted(): Banner[] {
    return [...this.items].sort(byOrder);
  }

  /** Solo los publicados, en el orden configurado (vista del público). */
  published(): Banner[] {
    return this.sorted().filter(b => b.isActive);
  }

  /** Los banners en el orden en que se guardaron. */
  toArray(): Banner[] {
    return this.items.map(b => ({ ...b }));
  }

  get size(): number {
    return this.items.length;
  }

  get activeCount(): number {
    return this.items.filter(b => b.isActive).length;
  }

  /** Las URLs de imagen que este catálogo usa y `next` ya no (sin repetir). */
  imagesOrphanedBy(next: BannerCatalog): string[] {
    const kept = new Set(next.items.map(b => b.imageUrl).filter(Boolean));
    return [...new Set(this.items.map(b => b.imageUrl).filter((url): url is string => Boolean(url) && !kept.has(url)))];
  }
}
