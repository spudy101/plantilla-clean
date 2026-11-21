// Lo que devuelven los casos de uso de catálogos (output DTOs): datos planos, uno por tipo de entrada.
// Las relaciones (país del departamento, tema del avatar…) salen solo si el repositorio las trajo.
//
// La forma es EXACTAMENTE la que respondía la plantilla en capas (el contrato de la API no cambia),
// incluidos sus detalles: una referencia anidada a un país sale con `iconUrl: null` y la de un
// departamento con `daneCode: null`, porque el repositorio no lee esas columnas en la relación.
import type { PageMetadata } from '../../../../shared/application/pagination';
import type {
  ActivePrivacyPolicy,
  Avatar,
  AvatarTheme,
  City,
  Country,
  CountryRef,
  Department,
  DocumentType,
  Gender,
  NotificationCategoryEntry,
  NotificationTypeEntry,
  PhonePrefix,
  RoleEntry
} from '../../domain/catalog-entries';

/** Respuesta de un listado: los elementos y la metadata de paginación, orden y filtros aplicados. */
export interface ListOutput<T> {
  data: T[];
  metadata: PageMetadata;
}

const status = (entry: { isActive: boolean | null; createdAt: Date; updatedAt: Date }) => ({
  isActive: entry.isActive,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt
});

const countryRefOutput = (country: CountryRef) => ({
  countryId: country.countryId,
  name: country.name,
  code: country.code,
  iconUrl: null
});

export const toCountryOutput = (country: Country) => ({
  countryId: country.countryId,
  name: country.name,
  code: country.code,
  iconUrl: country.iconUrl || null,
  ...status(country)
});

export const toDepartmentOutput = (department: Department) => ({
  departmentId: department.departmentId,
  name: department.name,
  daneCode: department.daneCode || null,
  countryId: department.countryId,
  ...status(department),
  ...(department.country ? { country: countryRefOutput(department.country) } : {})
});

export const toCityOutput = (city: City) => ({
  cityId: city.cityId,
  name: city.name,
  daneCode: city.daneCode || null,
  departmentId: city.departmentId,
  ...status(city),
  ...(city.department
    ? {
        department: {
          departmentId: city.department.departmentId,
          name: city.department.name,
          daneCode: null,
          ...(city.department.country ? { country: countryRefOutput(city.department.country) } : {})
        }
      }
    : {})
});

export const toPhonePrefixOutput = (phonePrefix: PhonePrefix) => ({
  phonePrefixId: phonePrefix.phonePrefixId,
  prefix: phonePrefix.prefix,
  countryId: phonePrefix.countryId,
  ...status(phonePrefix),
  ...(phonePrefix.country ? { country: countryRefOutput(phonePrefix.country) } : {})
});

export const toGenderOutput = (gender: Gender) => ({ genderId: gender.genderId, name: gender.name, ...status(gender) });

export const toAvatarThemeOutput = (theme: AvatarTheme) => ({
  avatarThemeId: theme.avatarThemeId,
  name: theme.name,
  ...status(theme)
});

export const toAvatarOutput = (avatar: Avatar) => ({
  avatarId: avatar.avatarId,
  name: avatar.name,
  imageUrl: avatar.imageUrl || null,
  avatarThemeId: avatar.avatarThemeId,
  ...status(avatar),
  ...(avatar.theme ? { theme: { avatarThemeId: avatar.theme.avatarThemeId, name: avatar.theme.name } } : {})
});

export const toDocumentTypeOutput = (documentType: DocumentType) => ({
  documentTypeId: documentType.documentTypeId,
  code: documentType.code,
  name: documentType.name,
  isVisibleToClient: documentType.isVisibleToClient,
  isActive: documentType.isActive
});

export const toRoleOutput = (role: RoleEntry) => ({
  roleId: role.roleId,
  name: role.name,
  description: role.description || null,
  ...status(role)
});

const toNotificationCategoryOutput = (category: NotificationCategoryEntry) => ({
  notificationCategoryId: category.notificationCategoryId,
  code: category.code,
  name: category.name,
  description: category.description || null,
  supportsPush: category.supportsPush,
  supportsEmail: category.supportsEmail,
  supportsSms: category.supportsSms,
  isCritical: category.isCritical,
  isActive: category.isActive
});

export const toNotificationTypeOutput = (type: NotificationTypeEntry) => ({
  notificationTypeId: type.notificationTypeId,
  code: type.code,
  name: type.name,
  description: type.description || null,
  notificationCategoryId: type.notificationCategoryId || null,
  isActive: type.isActive,
  ...(type.category ? { category: toNotificationCategoryOutput(type.category) } : {})
});

export const toActivePrivacyPolicyOutput = (policy: ActivePrivacyPolicy) => ({
  version: policy.version,
  documentUrl: policy.documentUrl,
  summary: policy.summary || null,
  effectiveDate: policy.effectiveDate
});
export type ActivePrivacyPolicyOutput = ReturnType<typeof toActivePrivacyPolicyOutput>;
