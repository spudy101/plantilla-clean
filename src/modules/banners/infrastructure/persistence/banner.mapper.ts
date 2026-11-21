// Traduce entre system_global_config.promotional_banners (JSONB, snake_case) y el catálogo del dominio. Es el
// único lugar que conoce esa forma de guardado; lo que sale es siempre lista blanca, nunca el JSONB crudo.
import { BannerCatalog, type Banner } from '../../domain/banner-catalog';

/** Un banner tal como se guarda. Los campos opcionales pueden faltar en datos viejos. */
export interface StoredBanner {
  id: string;
  title: string;
  text: string;
  tag?: string | null;
  button_route?: string | null;
  button_name?: string | null;
  image_url?: string | null;
  is_active?: boolean;
  sort_order?: number | null;
}

export const BannerMapper = {
  /** JSONB → catálogo. Un valor que no es arreglo se lee como catálogo vacío. */
  toDomain(raw: unknown): BannerCatalog {
    const stored = Array.isArray(raw) ? (raw as StoredBanner[]) : [];
    return BannerCatalog.restore(
      stored.map(
        (b): Banner => ({
          id: b.id,
          title: b.title,
          text: b.text,
          tag: b.tag ?? null,
          buttonRoute: b.button_route ?? null,
          buttonName: b.button_name ?? null,
          imageUrl: b.image_url ?? null,
          // Un banner sin is_active (dato viejo) se considera publicado
          isActive: b.is_active !== false,
          sortOrder: b.sort_order ?? null
        })
      )
    );
  },

  toStored(catalog: BannerCatalog): StoredBanner[] {
    return catalog.toArray().map(b => ({
      id: b.id,
      title: b.title,
      text: b.text,
      tag: b.tag,
      button_route: b.buttonRoute,
      button_name: b.buttonName,
      image_url: b.imageUrl,
      is_active: b.isActive,
      sort_order: b.sortOrder
    }));
  }
};
