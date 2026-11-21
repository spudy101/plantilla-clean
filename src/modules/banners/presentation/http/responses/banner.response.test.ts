// Conformidad: la salida de los casos de uso cumple los esquemas que documenta Swagger (estrictos).
import { AdminBannerList, BannerImage } from './admin-promotional-banner.response';
import { PublicBannerList } from './promotional-banner.response';
import { toAdminBannerList, toPublicBannerList } from '../../../application/dto/banner.output';
import { BannerCatalog } from '../../../domain/banner-catalog';
import { banner } from '../../../../../../tests/doubles/banners.doubles';

const catalog = BannerCatalog.restore([
  banner({ id: '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c11', tag: 'Nuevo', imageUrl: 'https://cdn.test/a.png' }),
  banner({ id: '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c12', isActive: false, sortOrder: null })
]);

describe('Banners — salida conforme al esquema', () => {
  it('lista admin', () => {
    const value = toAdminBannerList(catalog);
    expect(AdminBannerList.strict().parse(value)).toEqual(value);
    expect(() => value.banners.forEach(b => AdminBannerList.shape.banners.element.strict().parse(b))).not.toThrow();
  });

  it('lista pública (sin isActive ni sortOrder)', () => {
    const value = toPublicBannerList(catalog);
    expect(() => value.banners.forEach(b => PublicBannerList.shape.banners.element.strict().parse(b))).not.toThrow();
    expect(value.banners).toHaveLength(1);
  });

  it('imagen subida', () => {
    expect(() =>
      BannerImage.strict().parse({ imageUrl: 'https://cdn.test/a.png', s3Key: 'promotional/banners/a.png' })
    ).not.toThrow();
  });
});
