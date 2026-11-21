// Esquemas de la respuesta pública de banners (landing + app cliente). No expone isActive ni sortOrder: el
// público solo ve contenido publicado, ya ordenado.
import { z } from '../../../../../shared/presentation/validation/z';

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
