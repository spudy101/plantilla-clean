// El adaptador S3 decide el nombre de cada imagen y qué imágenes son "suyas" (las que puede borrar).
import { S3BannerImageStorage, managedImageKey, type PublicFileStore } from './s3-banner-image.storage';

const ids = { next: () => 'uuid-1' };
const fakeStore = () => {
  const store = {
    uploadPublicDocument: jest.fn(async (_buffer: Buffer, key: string) => `https://cdn.test/${key}`),
    deletePublicFile: jest.fn(async (_key: string) => undefined)
  };
  return store as typeof store & PublicFileStore;
};

describe('S3BannerImageStorage.upload', () => {
  it.each([
    ['image/jpeg', 'promotional/banners/uuid-1.jpg'],
    ['image/webp', 'promotional/banners/uuid-1.webp'],
    ['', 'promotional/banners/uuid-1.png']
  ])('%p → key %p, al bucket público', async (mimetype, key) => {
    const store = fakeStore();
    const result = await new S3BannerImageStorage(ids, store).upload({ buffer: Buffer.from('x'), mimetype });

    expect(result).toEqual({ url: `https://cdn.test/${key}`, key });
    expect(store.uploadPublicDocument).toHaveBeenCalledWith(expect.any(Buffer), key, mimetype);
  });
});

describe('S3BannerImageStorage.removeUnused', () => {
  it('borra solo las del prefijo de banners (sin repetir) e ignora URLs externas o malformadas', async () => {
    const store = fakeStore();
    const result = await new S3BannerImageStorage(ids, store).removeUnused([
      'https://cdn.test/promotional/banners/a.png',
      'https://otra-cdn.test/promotional/banners/a.png',
      'https://marca.test/logo.png',
      'no-es-una-url'
    ]);

    expect(result).toEqual({ attempted: ['promotional/banners/a.png'], deleted: 1 });
    expect(store.deletePublicFile).toHaveBeenCalledTimes(1);
  });

  it('un borrado que falla no lanza: cuenta solo los que salieron bien', async () => {
    const store = fakeStore();
    store.deletePublicFile.mockRejectedValueOnce(new Error('S3 caído'));
    const result = await new S3BannerImageStorage(ids, store).removeUnused([
      'https://cdn.test/promotional/banners/a.png',
      'https://cdn.test/promotional/banners/b.png'
    ]);

    expect(result.deleted).toBe(1);
  });
});

describe('managedImageKey', () => {
  it('la key solo si está bajo promotional/banners/', () => {
    expect(managedImageKey('https://cdn.test/promotional/banners/x.png')).toBe('promotional/banners/x.png');
    expect(managedImageKey('https://cdn.test/otra/x.png')).toBeNull();
  });
});
