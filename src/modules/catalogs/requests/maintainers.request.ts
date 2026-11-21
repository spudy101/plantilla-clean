// Entrada de los catálogos (solo lectura): paginación, orden y filtros de cada listado.
// Cada catálogo declara por qué campos se ordena (pageQuery) y qué filtros acepta: lo demás se descarta.
import { z } from '../../../shared/presentation/validation/z';
import { optionalBool, optionalUuid, pageQuery, searchQuery } from '../../../shared/presentation/validation/fields';

const filters = { ...searchQuery, isActive: optionalBool('isActive') };
const byName = pageQuery(['createdAt', 'name'], { sortBy: 'createdAt' });
const byNameOrCode = pageQuery(['createdAt', 'name', 'code'], { sortBy: 'createdAt' });

export const GenderListQuery = z.object({ ...byName, ...filters });
export type GenderListQuery = z.output<typeof GenderListQuery>;

export const CountryListQuery = z.object({ ...byNameOrCode, ...filters });
export type CountryListQuery = z.output<typeof CountryListQuery>;

export const DepartmentListQuery = z.object({ ...byName, ...filters, countryId: optionalUuid('countryId') });
export type DepartmentListQuery = z.output<typeof DepartmentListQuery>;

export const CityListQuery = z.object({ ...byName, ...filters, departmentId: optionalUuid('departmentId') });
export type CityListQuery = z.output<typeof CityListQuery>;

export const PhonePrefixListQuery = z.object({
  ...pageQuery(['createdAt', 'prefix'], { sortBy: 'createdAt' }),
  ...filters,
  countryId: optionalUuid('countryId')
});
export type PhonePrefixListQuery = z.output<typeof PhonePrefixListQuery>;

export const AvatarListQuery = z.object({ ...byName, ...filters, themeId: optionalUuid('themeId') });
export type AvatarListQuery = z.output<typeof AvatarListQuery>;

export const AvatarThemeListQuery = z.object({ ...byName, ...filters });
export type AvatarThemeListQuery = z.output<typeof AvatarThemeListQuery>;

export const RoleListQuery = z.object({ ...byName, ...filters });
export type RoleListQuery = z.output<typeof RoleListQuery>;

export const NotificationTypeCatalogListQuery = z.object({ ...byNameOrCode, ...filters });
export type NotificationTypeCatalogListQuery = z.output<typeof NotificationTypeCatalogListQuery>;
