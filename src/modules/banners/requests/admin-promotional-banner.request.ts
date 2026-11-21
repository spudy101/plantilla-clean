// Entrada del mantenedor admin de banners. Un esquema por petición: valida (middleware validate), da el
// tipo que recibe el service (z.infer) y genera la documentación OpenAPI. Una sola fuente.
import { z, withHint } from '../../../shared/validation/z';
import { uuid, text, optionalText, positiveInt, bool } from '../../../shared/validation/fields';

const MAX_BANNERS = 20;
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const BannerInput = z.object({
  id: withHint(uuid('id').nullish(), { hint: 'Omitilo (o null) para crear un banner nuevo', description: 'Omitir (o null) para crear un banner nuevo.' }),
  title: text('El título', { max: 120 }),
  text: text('El texto', { max: 500 }),
  tag: optionalText('La etiqueta', 40),
  buttonRoute: optionalText('La ruta del botón', 200).meta({ description: 'Ruta interna del front a la que lleva el botón.' }),
  buttonName: optionalText('El texto del botón', 60).meta({ description: 'Texto visible del botón del banner.' }),
  imageUrl: optionalText('La URL de la imagen', 500).meta({ description: 'URL devuelta por POST /promotional-banners/image (o una ya existente).' }),
  isActive: bool('isActive').optional().meta({ description: 'Por defecto true.' }),
  sortOrder: positiveInt('El orden').nullish().meta({ description: 'Por defecto, la posición en el arreglo.' })
});
export type BannerInput = z.infer<typeof BannerInput>;

/** PUT /promotional-banners — reemplazo COMPLETO del catálogo: lo que no venga en el arreglo se elimina. */
export const ReplaceBannersBody = z
  .object({
    banners: withHint(z.array(BannerInput).max(MAX_BANNERS, { error: `Se admiten máximo ${MAX_BANNERS} banners` }), {
      hint: `Mandá el catálogo completo, hasta ${MAX_BANNERS} banners`
    })
  })
  .meta({ description: 'Reemplazo COMPLETO del catálogo: lo que no venga se elimina. Los banners sin `id` se crean.' });
export type ReplaceBannersBody = z.infer<typeof ReplaceBannersBody>;

/** POST /promotional-banners/image — el archivo llega por multipart (campo "image"), en req.files. */
export const BannerImageFiles = z.object(
  {
    image: withHint(
      z
        .array(z.object({ mimetype: z.enum(IMAGE_MIMES, { error: 'Formato de imagen no soportado: usá PNG, JPEG o WebP' }) }))
        .min(1, { error: 'La imagen es requerida (campo multipart "image")' }),
      { hint: 'Adjuntá un archivo PNG, JPEG o WebP en el campo "image"' }
    )
  },
  { error: 'La imagen es requerida (campo multipart "image")' }
);
