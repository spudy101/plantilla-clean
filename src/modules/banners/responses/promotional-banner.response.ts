// Salida pública de banners (landing + app cliente). No expone isActive ni sortOrder: el público solo ve
// contenido publicado, ya ordenado.
import { z } from '../../../shared/presentation/validation/z';
import type { StoredBanner } from './admin-promotional-banner.response';

export const PublicBanner = z.object({
  id: z.uuid(),
  title: z.string().meta({ example: 'Descubre las novedades de Base Project' }),
  text: z.string(),
  tag: z.string().nullable(),
  buttonRoute: z.string().nullable(),
  buttonName: z.string().nullable(),
  imageUrl: z.string().nullable()
});
export type PublicBanner = z.infer<typeof PublicBanner>;

export const PublicBannerList = z.object({
  banners: z.array(PublicBanner).meta({ description: 'Banners activos, en el orden configurado.' })
});
export type PublicBannerList = z.infer<typeof PublicBannerList>;

/** Recibe los banners ya filtrados (solo activos) y los ordena por sort_order. */
export function toPublicBannerList(banners: readonly StoredBanner[] | null | undefined): PublicBannerList {
  const items = [...(Array.isArray(banners) ? banners : [])];
  items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return {
    banners: items.map(b => ({
      id: b.id,
      title: b.title,
      text: b.text,
      tag: b.tag ?? null,
      buttonRoute: b.button_route ?? null,
      buttonName: b.button_name ?? null,
      imageUrl: b.image_url ?? null
    }))
  };
}
