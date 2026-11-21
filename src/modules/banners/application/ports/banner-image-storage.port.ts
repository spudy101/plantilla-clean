// Puerto del almacenamiento público de las imágenes de banners. En producción es S3 + CloudFront
// (infrastructure/storage/s3-banner-image.storage.ts); el caso de uso no sabe de buckets ni de keys.
export interface BannerImageFile {
  buffer: Buffer;
  mimetype: string;
}

export interface StoredBannerImage {
  /** URL pública y estable, para usar en el catálogo. */
  url: string;
  /** Dónde quedó guardada (para soporte y auditoría). */
  key: string;
}

export interface BannerImageStorage {
  /** Guarda la imagen con un nombre único (no pisa ninguna otra). */
  upload(file: BannerImageFile): Promise<StoredBannerImage>;

  /**
   * Borra las imágenes de estas URLs que el mantenedor de banners subió. Las URLs externas (assets de marca,
   * terceros) se ignoran. No lanza: devuelve qué intentó borrar y cuántas pudo.
   */
  removeUnused(urls: readonly string[]): Promise<{ attempted: string[]; deleted: number }>;
}
