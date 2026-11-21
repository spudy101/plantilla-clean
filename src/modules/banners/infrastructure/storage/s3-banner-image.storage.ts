// Adaptador S3 del puerto BannerImageStorage: las imágenes van al bucket PÚBLICO (URL de CloudFront estable y
// cacheable: el contenido es público, no hace falta firmar). Cada imagen sube con un nombre único, así que
// no hay caché vieja que invalidar.
import S3Util from '../../../../shared/infrastructure/storage/s3.util';
import type { IdGenerator } from '../../../../shared/application/ports/id-generator.port';
import type { BannerImageFile, BannerImageStorage, StoredBannerImage } from '../../application/ports/banner-image-storage.port';

/** Prefijo del bucket donde el mantenedor de banners guarda sus imágenes. Solo borra lo que está acá. */
export const BANNER_IMAGE_PREFIX = 'promotional/banners';

/** Lo que el adaptador usa del cliente de S3 (inyectable en tests). */
export type PublicFileStore = Pick<typeof S3Util, 'uploadPublicDocument' | 'deletePublicFile'>;

/** La key de S3 de una imagen SOLO si vive bajo el prefijo de banners. URLs externas o malformadas → null. */
export function managedImageKey(imageUrl: string): string | null {
  try {
    const key = new URL(imageUrl).pathname.replace(/^\/+/, '');
    return key.startsWith(`${BANNER_IMAGE_PREFIX}/`) ? key : null;
  } catch {
    return null;
  }
}

export class S3BannerImageStorage implements BannerImageStorage {
  constructor(
    private readonly ids: IdGenerator,
    private readonly files: PublicFileStore = S3Util
  ) {}

  async upload(file: BannerImageFile): Promise<StoredBannerImage> {
    const extension = (file.mimetype?.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
    const key = `${BANNER_IMAGE_PREFIX}/${this.ids.next()}.${extension}`;
    const url = await this.files.uploadPublicDocument(file.buffer, key, file.mimetype);
    return { url, key };
  }

  async removeUnused(urls: readonly string[]): Promise<{ attempted: string[]; deleted: number }> {
    const attempted = [...new Set(urls.map(managedImageKey).filter((key): key is string => key !== null))];
    if (attempted.length === 0) {
      return { attempted, deleted: 0 };
    }
    const results = await Promise.allSettled(attempted.map(key => this.files.deletePublicFile(key)));
    return { attempted, deleted: results.filter(r => r.status === 'fulfilled').length };
  }
}
