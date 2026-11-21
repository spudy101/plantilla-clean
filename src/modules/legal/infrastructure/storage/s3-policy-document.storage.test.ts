// Adaptador S3 del PDF de la política: sube al bucket público, invalida la CDN y calcula la huella.
import crypto from 'node:crypto';
import { S3PolicyDocumentStorage, type PublicDocumentStore } from './s3-policy-document.storage';

describe('S3PolicyDocumentStorage', () => {
  it('sube como PDF, invalida la ruta en CloudFront y devuelve URL + SHA-256', async () => {
    const files = {
      uploadPublicDocument: jest.fn().mockResolvedValue('https://cdn.test/legal/privacy-policy-v1-1.pdf'),
      invalidateCloudFront: jest.fn().mockResolvedValue(undefined)
    };
    const content = Buffer.from('%PDF-1.4');

    const result = await new S3PolicyDocumentStorage(files as unknown as PublicDocumentStore).publish('legal/privacy-policy-v1-1.pdf', content);

    expect(files.uploadPublicDocument).toHaveBeenCalledWith(expect.any(Buffer), 'legal/privacy-policy-v1-1.pdf', 'application/pdf');
    expect(files.invalidateCloudFront).toHaveBeenCalledWith('/legal/privacy-policy-v1-1.pdf');
    expect(result).toEqual({
      url: 'https://cdn.test/legal/privacy-policy-v1-1.pdf',
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    });
  });
});
