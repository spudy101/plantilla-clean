// Esquemas de la respuesta del mantenedor admin de banners: describen (y documentan en Swagger) la salida de
// los casos de uso (application/dto/banner.output.ts).
import { z } from '../../../../../shared/presentation/validation/z';

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
