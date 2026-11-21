// Esquemas de entrada del mantenedor de banners: lo que acepta y rechaza el PUT y la subida de imagen.
import { ReplaceBannersBody, BannerImageFiles } from './admin-promotional-banner.request';

const valid = { title: ' Novedades ', text: 'Texto del banner' };

describe('ReplaceBannersBody', () => {
  it('acepta un banner mínimo, recorta textos y deja los opcionales sin definir', () => {
    expect(ReplaceBannersBody.parse({ banners: [valid] })).toEqual({ banners: [{ title: 'Novedades', text: 'Texto del banner' }] });
  });

  it('acepta un catálogo vacío (borra todos los banners)', () => {
    expect(ReplaceBannersBody.parse({ banners: [] })).toEqual({ banners: [] });
  });

  it('convierte sortOrder enviado como texto', () => {
    expect(ReplaceBannersBody.parse({ banners: [{ ...valid, sortOrder: '2' }] }).banners[0]?.sortOrder).toBe(2);
  });

  it.each([
    ['sin banners', {}, 'banners'],
    ['más de 20', { banners: Array.from({ length: 21 }, () => valid) }, 'banners'],
    ['título vacío', { banners: [{ ...valid, title: '   ' }] }, 'banners.0.title'],
    ['texto de más de 500', { banners: [{ ...valid, text: 'x'.repeat(501) }] }, 'banners.0.text'],
    ['id que no es UUID', { banners: [{ ...valid, id: 'abc' }] }, 'banners.0.id'],
    ['isActive como texto', { banners: [{ ...valid, isActive: 'yes' }] }, 'banners.0.isActive'],
    ['sortOrder 0', { banners: [{ ...valid, sortOrder: 0 }] }, 'banners.0.sortOrder']
  ])('rechaza %s', (_name, input, field) => {
    const result = ReplaceBannersBody.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(i => i.path.join('.'))).toContain(field);
  });
});

describe('BannerImageFiles', () => {
  it('acepta una imagen PNG, JPEG o WebP', () => {
    for (const mimetype of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(BannerImageFiles.safeParse({ image: [{ mimetype }] }).success).toBe(true);
    }
  });

  it('rechaza sin archivo o con otro formato', () => {
    expect(BannerImageFiles.safeParse(undefined).success).toBe(false);
    expect(BannerImageFiles.safeParse({ image: [] }).success).toBe(false);
    expect(BannerImageFiles.safeParse({ image: [{ mimetype: 'application/pdf' }] }).success).toBe(false);
  });
});
