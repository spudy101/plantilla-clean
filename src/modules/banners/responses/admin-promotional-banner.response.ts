// Salida del mantenedor admin de banners. El esquema describe (y documenta) la respuesta; la función arma
// esa respuesta campo a campo desde lo guardado: lista blanca, nunca el JSONB crudo.
import { z } from '../../../shared/presentation/validation/z';

/** Banner tal como se guarda en system_global_configs.promotional_banners (JSONB, snake_case). */
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

export const AdminBanner = z
  .object({
    id: z.uuid(),
    title: z.string().meta({ example: 'Descubre las novedades de Base Project' }),
    text: z.string(),
    tag: z.string().nullable().meta({ example: 'Nuevo' }),
    buttonRoute: z.string().nullable().meta({ example: '/hub/inicio' }),
    buttonName: z.string().nullable().meta({ example: 'Explorar' }),
    imageUrl: z.string().nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int().nullable()
  })
  .meta({ description: 'Banner promocional (vista admin: incluye isActive y sortOrder).' });
export type AdminBanner = z.infer<typeof AdminBanner>;

export const AdminBannerList = z.object({
  banners: z.array(AdminBanner).meta({ description: 'Catálogo completo ordenado por sortOrder ascendente.' })
});
export type AdminBannerList = z.infer<typeof AdminBannerList>;

export const BannerImage = z.object({
  imageUrl: z.string().meta({ description: 'URL pública (CloudFront) para usar en imageUrl del PUT.' }),
  s3Key: z.string()
});
export type BannerImage = z.infer<typeof BannerImage>;

function toAdminBanner(b: StoredBanner): AdminBanner {
  return {
    id: b.id,
    title: b.title,
    text: b.text,
    tag: b.tag ?? null,
    buttonRoute: b.button_route ?? null,
    buttonName: b.button_name ?? null,
    imageUrl: b.image_url ?? null,
    isActive: b.is_active !== false,
    sortOrder: b.sort_order ?? null
  };
}

export function toAdminBannerList(banners: readonly StoredBanner[] | null | undefined): AdminBannerList {
  const items = (Array.isArray(banners) ? banners : []).map(toAdminBanner);
  items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return { banners: items };
}

export function toBannerImage(imageUrl: string, s3Key: string): BannerImage {
  return { imageUrl, s3Key };
}
