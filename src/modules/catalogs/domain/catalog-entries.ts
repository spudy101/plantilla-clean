// Las entradas de los catálogos (datos de referencia: países, ciudades, géneros, tipos de documento…).
//
// Son modelos de solo lectura del dominio: no tienen comportamiento porque el catálogo no tiene reglas
// propias más allá de existir y estar activo. Son TypeScript puro: los repositorios Prisma los arman con
// su mapper (infrastructure/persistence/catalog.mapper.ts) y la presentación los serializa.
//
// Rol, tipo de notificación y política de privacidad son de otros módulos (iam, notification, legal): el
// catálogo solo los MUESTRA, así que tiene su propia vista de cada uno y src/main/ le pasa de dónde leerlos.

interface CatalogEntry {
  name: string;
  /** null en filas viejas sin valor: se trata como activa. */
  isActive: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Country extends CatalogEntry {
  countryId: string;
  /** ISO 3166 alfa-3 (p. ej. 'COL'). */
  code: string;
  iconUrl: string | null;
}

/** Referencia al país dentro de otra entrada (departamento, prefijo telefónico). */
export type CountryRef = Pick<Country, 'countryId' | 'name' | 'code'>;

export interface Department extends CatalogEntry {
  departmentId: string;
  daneCode: string | null;
  countryId: string;
  country?: CountryRef;
}

export interface City extends CatalogEntry {
  cityId: string;
  daneCode: string | null;
  departmentId: string;
  department?: Pick<Department, 'departmentId' | 'name'> & { country?: CountryRef };
}

export interface PhonePrefix extends Omit<CatalogEntry, 'name'> {
  phonePrefixId: string;
  /** Con '+', p. ej. '+57'. */
  prefix: string;
  countryId: string;
  country?: CountryRef;
}

export interface Gender extends CatalogEntry {
  genderId: string;
}

export interface AvatarTheme extends CatalogEntry {
  avatarThemeId: string;
}

export interface Avatar extends CatalogEntry {
  avatarId: string;
  imageUrl: string | null;
  avatarThemeId: string;
  theme?: Pick<AvatarTheme, 'avatarThemeId' | 'name'>;
}

export interface DocumentType {
  documentTypeId: string;
  /** Sigla, p. ej. 'CC'. */
  code: string;
  name: string;
  /** Si aparece en el selector del formulario del cliente. */
  isVisibleToClient: boolean;
  isActive: boolean;
}

/** Vista de catálogo de un rol (el rol es de iam). */
export interface RoleEntry extends CatalogEntry {
  roleId: string;
  description: string | null;
}

/** Vista de catálogo de una categoría de notificación (es de notification). */
export interface NotificationCategoryEntry {
  notificationCategoryId: string;
  code: string;
  name: string;
  description: string | null;
  supportsPush: boolean;
  supportsEmail: boolean;
  supportsSms: boolean;
  isCritical: boolean;
  isActive: boolean;
}

/** Vista de catálogo de un tipo de notificación (es de notification). */
export interface NotificationTypeEntry {
  notificationTypeId: string;
  code: string;
  name: string;
  description: string | null;
  notificationCategoryId: string | null;
  isActive: boolean | null;
  category?: NotificationCategoryEntry;
}

/** La política de privacidad vigente, tal como se muestra al público (es de legal). */
export interface ActivePrivacyPolicy {
  version: string;
  documentUrl: string;
  summary: string | null;
  effectiveDate: Date;
}
