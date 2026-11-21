// El mapper es la frontera con el JSONB de promotional_banners (snake_case).
import { BannerMapper } from './banner.mapper';

describe('BannerMapper', () => {
  it('JSONB → catálogo: completa nulos y un is_active ausente se lee como publicado', () => {
    const catalog = BannerMapper.toDomain([
      { id: 'b1', title: 'T', text: 'x', image_url: 'https://cdn/a.png', extra: 'no sale' }
    ]);
    expect(catalog.toArray()).toEqual([
      {
        id: 'b1',
        title: 'T',
        text: 'x',
        tag: null,
        buttonRoute: null,
        buttonName: null,
        imageUrl: 'https://cdn/a.png',
        isActive: true,
        sortOrder: null
      }
    ]);
  });

  it('un JSONB que no es arreglo (null, objeto) es un catálogo vacío', () => {
    expect(BannerMapper.toDomain(null).size).toBe(0);
    expect(BannerMapper.toDomain({}).size).toBe(0);
  });

  it('catálogo → JSONB en snake_case, ida y vuelta sin pérdida', () => {
    const stored = [
      {
        id: 'b1',
        title: 'T',
        text: 'x',
        tag: 'N',
        button_route: '/r',
        button_name: 'Ir',
        image_url: null,
        is_active: false,
        sort_order: 2
      }
    ];
    expect(BannerMapper.toStored(BannerMapper.toDomain(stored))).toEqual(stored);
  });
});
