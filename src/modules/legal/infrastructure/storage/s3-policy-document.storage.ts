// Adaptador S3 del puerto PolicyDocumentStorage: el PDF va al bucket PÚBLICO (la política es pública) y se
// invalida su ruta en CloudFront para que la versión nueva se vea de inmediato (la ruta es predecible, así
// que una copia vieja podría quedar en la CDN). La huella SHA-256 sale del mismo contenido que se subió.
import crypto from 'node:crypto';
import S3Util from '../../../../shared/infrastructure/storage/s3.util';
import type { PolicyDocumentStorage, PublishedPolicyDocument } from '../../application/ports/policy-document-storage.port';

/** Lo que el adaptador usa del cliente de S3 (inyectable en tests). */
export type PublicDocumentStore = Pick<typeof S3Util, 'uploadPublicDocument' | 'invalidateCloudFront'>;

export class S3PolicyDocumentStorage implements PolicyDocumentStorage {
  constructor(private readonly files: PublicDocumentStore = S3Util) {}

  async publish(key: string, content: Uint8Array): Promise<PublishedPolicyDocument> {
    const buffer = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    const url = await this.files.uploadPublicDocument(buffer, key, 'application/pdf');
    // No bloquea si falla (S3Util lo registra)
    await this.files.invalidateCloudFront(`/${key}`);
    return { url, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  }
}
