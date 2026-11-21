// Lo que devuelven los casos de uso de banners. El público no ve isActive ni sortOrder: solo lo publicado,
// ya ordenado.
import type { Banner, BannerCatalog } from '../../domain/banner-catalog';

const publicFields = (b: Banner) => ({
  id: b.id,
  title: b.title,
  text: b.text,
  tag: b.tag,
  buttonRoute: b.buttonRoute,
  buttonName: b.buttonName,
  imageUrl: b.imageUrl
});

export const toAdminBannerList = (catalog: BannerCatalog) => ({
  banners: catalog.sorted().map(b => ({ ...publicFields(b), isActive: b.isActive, sortOrder: b.sortOrder }))
});
export type AdminBannerListOutput = ReturnType<typeof toAdminBannerList>;

export const toPublicBannerList = (catalog: BannerCatalog) => ({ banners: catalog.published().map(publicFields) });
export type PublicBannerListOutput = ReturnType<typeof toPublicBannerList>;

export interface BannerImageOutput {
  imageUrl: string;
  s3Key: string;
}
