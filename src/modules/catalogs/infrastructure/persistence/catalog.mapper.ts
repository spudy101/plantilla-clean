// Traduce las filas de Prisma a las entradas del dominio. Copia campo a campo (lista blanca): si la tabla
// suma una columna, no aparece sola en la respuesta.
import type {
  Avatar as AvatarRow,
  AvatarTheme as AvatarThemeRow,
  City as CityRow,
  Country as CountryRow,
  Department as DepartmentRow,
  DocumentType as DocumentTypeRow,
  Gender as GenderRow,
  PhonePrefix as PhonePrefixRow
} from '../../../../shared/infrastructure/database/generated/prisma/client';
import type {
  Avatar,
  AvatarTheme,
  City,
  Country,
  CountryRef,
  Department,
  DocumentType,
  Gender,
  PhonePrefix
} from '../../domain/catalog-entries';

type Status = { isActive: boolean | null; createdAt: Date; updatedAt: Date };
const status = (row: Status): Status => ({ isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt });

const countryRef = (row: CountryRef): CountryRef => ({ countryId: row.countryId, name: row.name, code: row.code });

export const CatalogMapper = {
  country: (row: CountryRow): Country => ({
    countryId: row.countryId,
    name: row.name,
    code: row.code,
    iconUrl: row.iconUrl,
    ...status(row)
  }),

  department: (row: DepartmentRow & { country?: CountryRef }): Department => ({
    departmentId: row.departmentId,
    name: row.name,
    daneCode: row.daneCode,
    countryId: row.countryId,
    ...status(row),
    ...(row.country ? { country: countryRef(row.country) } : {})
  }),

  city: (row: CityRow & { department?: { departmentId: string; name: string; country?: CountryRef } }): City => ({
    cityId: row.cityId,
    name: row.name,
    daneCode: row.daneCode,
    departmentId: row.departmentId,
    ...status(row),
    ...(row.department
      ? {
          department: {
            departmentId: row.department.departmentId,
            name: row.department.name,
            ...(row.department.country ? { country: countryRef(row.department.country) } : {})
          }
        }
      : {})
  }),

  phonePrefix: (row: PhonePrefixRow & { country?: CountryRef }): PhonePrefix => ({
    phonePrefixId: row.phonePrefixId,
    prefix: row.prefix,
    countryId: row.countryId,
    ...status(row),
    ...(row.country ? { country: countryRef(row.country) } : {})
  }),

  gender: (row: GenderRow): Gender => ({ genderId: row.genderId, name: row.name, ...status(row) }),

  avatarTheme: (row: AvatarThemeRow): AvatarTheme => ({ avatarThemeId: row.avatarThemeId, name: row.name, ...status(row) }),

  avatar: (row: AvatarRow & { theme?: { avatarThemeId: string; name: string } }): Avatar => ({
    avatarId: row.avatarId,
    name: row.name,
    imageUrl: row.imageUrl,
    avatarThemeId: row.avatarThemeId,
    ...status(row),
    ...(row.theme ? { theme: { avatarThemeId: row.theme.avatarThemeId, name: row.theme.name } } : {})
  }),

  documentType: (row: DocumentTypeRow): DocumentType => ({
    documentTypeId: row.documentTypeId,
    code: row.code,
    name: row.name,
    isVisibleToClient: row.isVisibleToClient,
    isActive: row.isActive
  })
};

/** `null` → `null`; si no, la entrada mapeada. */
export const mapOrNull = <Row, Entry>(row: Row | null, map: (found: Row) => Entry): Entry | null => (row ? map(row) : null);
