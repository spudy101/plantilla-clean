import type { PageMetadata } from '../../../shared/http/pagination';
import componentsCatalogDtoModule from './catalog-components.response';
const {
  CountryComponent,
  DepartmentComponent,
  CityComponent,
  PhonePrefixComponent,
  GenderComponent,
  AvatarThemeComponent,
  AvatarComponent,
  RoleComponent
} = componentsCatalogDtoModule;

import type { DocumentType, PrivacyPolicy } from '../../../shared/database/generated/prisma/client';
import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';
import notificationModule from '../../notification';
const { notificationComponentsDto: componentsNotificationDtoModule } = notificationModule;
const { NotificationTypeComponent } = componentsNotificationDtoModule;

/**
 * ============================================================
 * MAINTAINERS DTOs — CLIENT / PUBLIC
 * ============================================================
 * Usa los componentes del shared — nunca duplicar lógica aquí.
 * Todas las rutas de maintainers son públicas (sin auth).
 */

// ============================================================
// HELPER GENÉRICO — lista paginada
// ============================================================

/** Metadata de paginación (pageMetadata, shared/http/pagination.ts). */
type Metadata = PageMetadata;

function buildListResponse<T, R>(items: readonly T[] | null | undefined, metadata: Metadata, buildFn: (item: T) => R) {
  return {
    data: Array.isArray(items) ? items.map(buildFn) : [],
    metadata
  };
}

// ============================================================
// GENDERS
// ============================================================

function ListGendersResponseDTO(genders: Array<Parameters<typeof GenderComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(genders, metadata, g => GenderComponent.build(g));
}

// ============================================================
// PHONE PREFIXES
// ============================================================

function ListPhonePrefixesResponseDTO(prefixes: Array<Parameters<typeof PhonePrefixComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(prefixes, metadata, p => PhonePrefixComponent.build(p, true));
}

// ============================================================
// AVATARS
// ============================================================

function ListAvatarsResponseDTO(avatars: Array<Parameters<typeof AvatarComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(avatars, metadata, a => AvatarComponent.build(a, true));
}

// ============================================================
// AVATAR THEMES
// ============================================================

function ListAvatarThemesResponseDTO(themes: Array<Parameters<typeof AvatarThemeComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(themes, metadata, t => AvatarThemeComponent.build(t));
}

// ============================================================
// COUNTRIES
// ============================================================

function ListCountriesResponseDTO(countries: Array<Parameters<typeof CountryComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(countries, metadata, c => CountryComponent.build(c));
}

// ============================================================
// DEPARTMENTS
// ============================================================

function ListDepartmentsResponseDTO(departments: Array<Parameters<typeof DepartmentComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(departments, metadata, d => DepartmentComponent.build(d, true));
}

// ============================================================
// CITIES
// ============================================================

function ListCitiesResponseDTO(cities: Array<Parameters<typeof CityComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(cities, metadata, c => CityComponent.build(c, true));
}

// ============================================================
// POLÍTICA DE PRIVACIDAD
// ============================================================

function ActivePrivacyPolicyResponseDTO(
  policy: Pick<PrivacyPolicy, 'version' | 'documentUrl' | 'summary' | 'effectiveDate'>
) {
  return {
    version: policy.version,
    documentUrl: policy.documentUrl,
    summary: policy.summary || null,
    effectiveDate: policy.effectiveDate
  };
}

// ============================================================
// ROLES
// ============================================================

function ListRolesResponseDTO(roles: Array<Parameters<typeof RoleComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(roles, metadata, r => RoleComponent.build(r));
}

// ============================================================
// NOTIFICATION TYPES
// ============================================================

function ListNotificationTypesResponseDTO(types: Array<Parameters<typeof NotificationTypeComponent.build>[0]>, metadata: Metadata) {
  return buildListResponse(types, metadata, t => NotificationTypeComponent.build(t));
}

// ============================================================
// DOCUMENT TYPES
// ============================================================

function ListDocumentTypesResponseDTO(
  documentTypes: Array<Pick<DocumentType, 'documentTypeId' | 'code' | 'name' | 'isVisibleToClient' | 'isActive'>>,
  metadata: Metadata
) {
  return buildListResponse(documentTypes, metadata, dt => ({
    documentTypeId: dt.documentTypeId,
    code: dt.code,
    name: dt.name,
    isVisibleToClient: dt.isVisibleToClient,
    isActive: dt.isActive
  }));
}

// ============================================================
// ESQUEMAS DE SALIDA propios (los de país, ciudad, género… están en catalog-components)
// ============================================================

export const DocumentTypeSchema = z.object({
  documentTypeId: z.uuid(),
  code: z.string().meta({ example: 'CC', description: 'Código interno del tipo de documento.' }),
  name: z.string().meta({ example: 'Cédula de Ciudadanía' }),
  isVisibleToClient: z.boolean(),
  isActive: z.boolean()
});

export const ActivePrivacyPolicySchema = z.object({
  version: z.string().meta({ example: '1.0', description: 'Versión de la política' }),
  documentUrl: z.string().meta({ description: 'URL pública del documento PDF' }),
  summary: z.string().nullable(),
  effectiveDate: dateTime()
});

export default {
  ListGendersResponseDTO,
  ListDocumentTypesResponseDTO,
  ListPhonePrefixesResponseDTO,
  ListAvatarsResponseDTO,
  ListAvatarThemesResponseDTO,
  ListCountriesResponseDTO,
  ListDepartmentsResponseDTO,
  ListCitiesResponseDTO,
  ActivePrivacyPolicyResponseDTO,
  ListRolesResponseDTO,
  ListNotificationTypesResponseDTO
};
