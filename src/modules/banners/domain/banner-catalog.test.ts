// Reglas del catálogo de banners: TypeScript puro, sin base ni S3.
import { BannerCatalog } from './banner-catalog';
import { banner } from '../../../../tests/doubles/banners.doubles';

const ids = () => {
  let n = 0;
  return () => `nuevo-${++n}`;
};

describe('BannerCatalog.fromDrafts', () => {
  it('conserva los ids que vienen y genera los que faltan', () => {
    const catalog = BannerCatalog.fromDrafts(
      [
        { id: 'b1', title: 'A', text: 'a' },
        { title: 'B', text: 'b' },
        { id: null, title: 'C', text: 'c' }
      ],
      ids()
    );
    expect(catalog.toArray().map(b => b.id)).toEqual(['b1', 'nuevo-1', 'nuevo-2']);
  });

  it('completa los valores por defecto: activo, orden = posición, opcionales en null', () => {
    const [first, second] = BannerCatalog.fromDrafts(
      [
        { title: 'A', text: 'a' },
        { title: 'B', text: 'b', isActive: false, sortOrder: 7, tag: 'Nuevo' }
      ],
      ids()
    ).toArray();

    expect(first).toEqual({
      id: 'nuevo-1',
      title: 'A',
      text: 'a',
      tag: null,
      buttonRoute: null,
      buttonName: null,
      imageUrl: null,
      isActive: true,
      sortOrder: 1
    });
    expect(second).toMatchObject({ isActive: false, sortOrder: 7, tag: 'Nuevo' });
  });
});

describe('BannerCatalog — vistas', () => {
  const catalog = BannerCatalog.restore([
    banner({ id: 'c', sortOrder: 3 }),
    banner({ id: 'a', sortOrder: 1, isActive: false }),
    banner({ id: 'b', sortOrder: 2 }),
    banner({ id: 'sin-orden', sortOrder: null })
  ]);

  it('sorted: todos por sortOrder (sin orden va primero)', () => {
    expect(catalog.sorted().map(b => b.id)).toEqual(['sin-orden', 'a', 'b', 'c']);
  });

  it('published: solo los activos, en orden', () => {
    expect(catalog.published().map(b => b.id)).toEqual(['sin-orden', 'b', 'c']);
  });

  it('cuenta total y activos', () => {
    expect([catalog.size, catalog.activeCount]).toEqual([4, 3]);
  });
});

describe('BannerCatalog.imagesOrphanedBy', () => {
  it('las imágenes que el catálogo viejo usaba y el nuevo no (sin repetir ni vacías)', () => {
    const previous = BannerCatalog.restore([
      banner({ id: '1', imageUrl: 'https://cdn/x.png' }),
      banner({ id: '2', imageUrl: 'https://cdn/y.png' }),
      banner({ id: '3', imageUrl: 'https://cdn/y.png' }),
      banner({ id: '4', imageUrl: null })
    ]);
    const next = BannerCatalog.restore([banner({ id: '1', imageUrl: 'https://cdn/x.png' })]);

    expect(previous.imagesOrphanedBy(next)).toEqual(['https://cdn/y.png']);
  });
});
