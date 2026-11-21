// Caso de uso: el administrador sube la imagen de un banner. Devuelve la URL pública para usarla después en
// el reemplazo del catálogo (el banner no se toca acá).
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { BannerImageFile, BannerImageStorage } from '../ports/banner-image-storage.port';
import { BannerImageRequiredError } from '../../domain/errors';
import type { BannerImageOutput } from '../dto/banner.output';
import { BANNER_AUDIT_ENTITY } from './banner-audit';

export class UploadBannerImage {
  constructor(
    private readonly images: BannerImageStorage,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, file }: { actorId: string; file: BannerImageFile | null }): Promise<BannerImageOutput> {
    if (!file?.buffer) {
      throw new BannerImageRequiredError();
    }

    const { url, key } = await this.images.upload(file);

    await this.audit.record('PROMOTIONAL_BANNER_IMAGE_UPLOADED', { actorId, details: { s3Key: key }, ...BANNER_AUDIT_ENTITY });
    return { imageUrl: url, s3Key: key };
  }
}
