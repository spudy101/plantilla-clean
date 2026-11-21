// Casos de uso de banners con dobles en memoria de sus puertos: sin jest.mock, sin Prisma, sin S3.
import { ListAdminBanners } from './list-admin-banners.use-case';
import { ReplaceBanners } from './replace-banners.use-case';
import { UploadBannerImage } from './upload-banner-image.use-case';
import { ListPublicBanners, PUBLIC_BANNERS_CACHE_KEY, PUBLIC_BANNERS_CACHE_TTL_SECONDS } from './list-public-banners.use-case';
import { BannerCatalogNotFoundError, BannerCatalogVanishedError, BannerImageRequiredError } from '../../domain/errors';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import { RecordingAuditTrail, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import { InMemoryCache } from '../../../../../tests/doubles/catalogs.doubles';
import {
  banner,
  InMemoryBannerCatalogs,
  InMemoryBannerImages,
  sequentialIds
} from '../../../../../tests/doubles/banners.doubles';

const CDN = 'https://cdn.test/promotional/banners';

describe('ListAdminBanners', () => {
  it('devuelve el catálogo completo ordenado y audita', async () => {
    const audit = new RecordingAuditTrail();
    const result = await new ListAdminBanners(
      InMemoryBannerCatalogs.with([banner({ id: 'b2', sortOrder: 2, isActive: false }), banner({ id: 'b1', sortOrder: 1 })]),
      audit
    ).execute({ actorId: 'admin-1' });

    expect(result.banners.map(b => [b.id, b.isActive])).toEqual([
      ['b1', true],
      ['b2', false]
    ]);
    expect(audit.entries).toEqual([
      expect.objectContaining({ action: 'PROMOTIONAL_BANNERS_VIEWED_ADMIN', actorId: 'admin-1', entityId: 'cfg-1' })
    ]);
  });

  it('sin configuración activa → BannerCatalogNotFoundError', async () => {
    await expect(
      new ListAdminBanners(new InMemoryBannerCatalogs(null), new RecordingAuditTrail()).execute({ actorId: 'a' })
    ).rejects.toBeInstanceOf(BannerCatalogNotFoundError);
  });
});

describe('ReplaceBanners', () => {
  const setup = (catalogs: InMemoryBannerCatalogs, logger: Logger = silentLogger) => {
    const images = new InMemoryBannerImages();
    const audit = new RecordingAuditTrail();
    return { catalogs, images, audit, useCase: new ReplaceBanners(catalogs, images, sequentialIds(), audit, logger) };
  };

  it('guarda el catálogo nuevo (ids generados, valores por defecto) y audita totales', async () => {
    const { useCase, catalogs, audit } = setup(new InMemoryBannerCatalogs());

    const result = await useCase.execute({
      actorId: 'admin-1',
      banners: [
        { title: 'A', text: 'a' },
        { id: 'b-existente', title: 'B', text: 'b', isActive: false }
      ]
    });

    expect(result.banners.map(b => [b.id, b.sortOrder, b.isActive])).toEqual([
      ['id-1', 1, true],
      ['b-existente', 2, false]
    ]);
    expect(catalogs.stored?.catalog.size).toBe(2);
    expect(audit.entries[0]).toMatchObject({
      action: 'PROMOTIONAL_BANNERS_UPDATED',
      details: { total: 2, active: 1, imagesRemoved: 0 }
    });
  });

  it('borra las imágenes que quedaron huérfanas (solo las gestionadas) después de guardar', async () => {
    const { useCase, images, audit } = setup(
      InMemoryBannerCatalogs.with([
        banner({ id: 'b1', imageUrl: `${CDN}/vieja.png` }),
        banner({ id: 'b2', imageUrl: `${CDN}/sigue.png` }),
        banner({ id: 'b3', imageUrl: 'https://marca.test/logo.png' })
      ])
    );

    await useCase.execute({ actorId: 'admin-1', banners: [{ id: 'b2', title: 'B', text: 'b', imageUrl: `${CDN}/sigue.png` }] });

    expect(images.removed).toEqual([`${CDN}/vieja.png`]);
    expect(audit.entries[0]?.details).toMatchObject({ imagesRemoved: 1 });
  });

  it('si una imagen no se puede borrar, solo avisa en el log (el catálogo ya quedó guardado)', async () => {
    const warn = jest.fn();
    const { useCase, images, catalogs } = setup(InMemoryBannerCatalogs.with([banner({ imageUrl: `${CDN}/rota.png` })]), {
      ...silentLogger,
      warn
    });
    images.failOn.add(`${CDN}/rota.png`);

    await useCase.execute({ actorId: 'admin-1', banners: [] });

    expect(catalogs.stored?.catalog.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no se pudieron borrar'),
      expect.objectContaining({ deleted: 0, failed: 1 })
    );
  });

  it('sin configuración activa → BannerCatalogNotFoundError; si desaparece al guardar → BannerCatalogVanishedError', async () => {
    await expect(setup(new InMemoryBannerCatalogs(null)).useCase.execute({ actorId: 'a', banners: [] })).rejects.toBeInstanceOf(
      BannerCatalogNotFoundError
    );

    const vanishing = new InMemoryBannerCatalogs();
    vanishing.replace = async () => null;
    await expect(setup(vanishing).useCase.execute({ actorId: 'a', banners: [] })).rejects.toBeInstanceOf(
      BannerCatalogVanishedError
    );
  });
});

describe('UploadBannerImage', () => {
  it('sube la imagen, audita la key y devuelve URL + key', async () => {
    const images = new InMemoryBannerImages();
    const audit = new RecordingAuditTrail();

    const result = await new UploadBannerImage(images, audit).execute({
      actorId: 'admin-1',
      file: { buffer: Buffer.from('x'), mimetype: 'image/png' }
    });

    expect(result).toEqual({ imageUrl: `${CDN}/img-1.png`, s3Key: 'promotional/banners/img-1.png' });
    expect(audit.entries[0]).toMatchObject({
      action: 'PROMOTIONAL_BANNER_IMAGE_UPLOADED',
      details: { s3Key: 'promotional/banners/img-1.png' }
    });
  });

  it('sin archivo → BannerImageRequiredError (400)', async () => {
    await expect(
      new UploadBannerImage(new InMemoryBannerImages(), new RecordingAuditTrail()).execute({ actorId: 'a', file: null })
    ).rejects.toBeInstanceOf(BannerImageRequiredError);
  });
});

describe('ListPublicBanners', () => {
  it('solo los publicados, sin isActive ni sortOrder; se cachea 60 s y no vuelve a la base', async () => {
    const catalogs = InMemoryBannerCatalogs.with([banner({ id: 'oculto', isActive: false }), banner({ id: 'visible' })]);
    const cache = new InMemoryCache();
    const audit = new RecordingAuditTrail();
    const useCase = new ListPublicBanners(catalogs, cache, audit);

    const first = await useCase.execute();
    const second = await useCase.execute();

    expect(first.banners).toEqual([
      { id: 'visible', title: 'Título', text: 'Texto', tag: null, buttonRoute: null, buttonName: null, imageUrl: null }
    ]);
    expect(second).toBe(first);
    expect(catalogs.reads).toBe(1);
    expect(cache.ttls.get(PUBLIC_BANNERS_CACHE_KEY)).toBe(PUBLIC_BANNERS_CACHE_TTL_SECONDS);
    expect(audit.entries).toHaveLength(1);
  });

  it('sin configuración activa no falla: no hay banners', async () => {
    const result = await new ListPublicBanners(
      new InMemoryBannerCatalogs(null),
      new InMemoryCache(),
      new RecordingAuditTrail()
    ).execute();
    expect(result).toEqual({ banners: [] });
  });
});
