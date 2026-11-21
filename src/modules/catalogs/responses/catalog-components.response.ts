/**
 * ============================================================
 * SHARED COMPONENTS DTO — CATÁLOGO
 * ============================================================
 * Bloques reutilizables para entidades de catálogo/maestras.
 * Usado en cualquier módulo que necesite estos datos — nunca duplicar.
 *
 * Entradas: filas de Prisma (camelCase) para los catálogos ya migrados — country, department, city,
 * phonePrefix, gender, avatarTheme, avatar — y de Sequelize (snake_case) para role, que migra con el
 * núcleo de usuarios (docs/prisma-migration.md, fase 5). La salida es siempre camelCase.
 *
 * Relaciones esperadas (las incluyen los repositorios):
 *   department.country     (Country)
 *   city.department        (Department → department.country)
 *   phonePrefix.country    (Country)
 *   avatar.theme           (AvatarTheme)
 */
import type { DbDate, Maybe } from '../../../shared/types/db-rows';
import { z } from '../../../shared/validation/z';
import { dateTime } from '../../../shared/validation/output';

/** Campos comunes de las tablas de catálogo (filas de Prisma). */
interface CatalogRow {
  name?: Maybe<string>;
  isActive?: Maybe<boolean>;
  createdAt?: Maybe<DbDate>;
  updatedAt?: Maybe<DbDate>;
}

interface CountryRow extends CatalogRow {
  countryId: string;
  code?: Maybe<string>;
  iconUrl?: Maybe<string>;
}

interface DepartmentRow extends CatalogRow {
  departmentId: string;
  daneCode?: Maybe<string>;
  countryId?: Maybe<string>;
  country?: Maybe<CountryRow>;
}

interface CityRow extends CatalogRow {
  cityId: string;
  daneCode?: Maybe<string>;
  departmentId?: Maybe<string>;
  department?: Maybe<DepartmentRow>;
}

interface PhonePrefixRow extends CatalogRow {
  phonePrefixId: string;
  prefix?: Maybe<string>;
  countryId?: Maybe<string>;
  country?: Maybe<CountryRow>;
}

interface GenderRow extends CatalogRow {
  genderId: string;
}

interface RoleRow {
  roleId: string;
  name?: Maybe<string>;
  description?: Maybe<string>;
  isActive?: Maybe<boolean>;
  createdAt?: Maybe<DbDate>;
  updatedAt?: Maybe<DbDate>;
}

interface AvatarThemeRow extends CatalogRow {
  avatarThemeId: string;
}

interface AvatarRow extends CatalogRow {
  avatarId: string;
  imageUrl?: Maybe<string>;
  avatarThemeId?: Maybe<string>;
  theme?: Maybe<AvatarThemeRow>;
}

// ============================================================
// COUNTRY
// ============================================================

class CountryComponent {
  static build(country: Maybe<CountryRow>) {
    if (!country) {
      return null;
    }
    return {
      countryId: country.countryId,
      name: country.name,
      code: country.code,
      iconUrl: country.iconUrl || null,
      isActive: country.isActive,
      createdAt: country.createdAt,
      updatedAt: country.updatedAt
    };
  }
}

// ============================================================
// DEPARTMENT
// ============================================================

class DepartmentComponent {
  /**
   * @param includeCountry Incluir asociación country (alias `department.country`)
   */
  static build(department: Maybe<DepartmentRow>, includeCountry = false) {
    if (!department) {
      return null;
    }

    const dto: {
      departmentId: string;
      name: Maybe<string>;
      daneCode: string | null;
      countryId: Maybe<string>;
      isActive: Maybe<boolean>;
      createdAt: Maybe<DbDate>;
      updatedAt: Maybe<DbDate>;
      country?: ReturnType<typeof CountryComponent.build>;
    } = {
      departmentId: department.departmentId,
      name: department.name,
      daneCode: department.daneCode || null,
      countryId: department.countryId,
      isActive: department.isActive,
      createdAt: department.createdAt,
      updatedAt: department.updatedAt
    };

    if (includeCountry && department.country) {
      dto.country = CountryComponent.build(department.country);
    }

    return dto;
  }
}

// ============================================================
// CITY
// ============================================================

class CityComponent {
  /**
   * @param includeDepartment Incluir asociación department (y su country) — alias `city.department`
   */
  static build(city: Maybe<CityRow>, includeDepartment = false) {
    if (!city) {
      return null;
    }

    const dto: {
      cityId: string;
      name: Maybe<string>;
      daneCode: string | null;
      departmentId: Maybe<string>;
      isActive: Maybe<boolean>;
      createdAt: Maybe<DbDate>;
      updatedAt: Maybe<DbDate>;
      department?: ReturnType<typeof DepartmentComponent.build>;
    } = {
      cityId: city.cityId,
      name: city.name,
      daneCode: city.daneCode || null,
      departmentId: city.departmentId,
      isActive: city.isActive,
      createdAt: city.createdAt,
      updatedAt: city.updatedAt
    };

    if (includeDepartment && city.department) {
      dto.department = DepartmentComponent.build(city.department, true);
    }

    return dto;
  }
}

// ============================================================
// PHONE PREFIX
// ============================================================

class PhonePrefixComponent {
  /**
   * @param includeCountry Incluir asociación country (alias `phonePrefix.country`)
   */
  static build(phonePrefix: Maybe<PhonePrefixRow>, includeCountry = false) {
    if (!phonePrefix) {
      return null;
    }

    const dto: {
      phonePrefixId: string;
      prefix: Maybe<string>;
      countryId: Maybe<string>;
      isActive: Maybe<boolean>;
      createdAt: Maybe<DbDate>;
      updatedAt: Maybe<DbDate>;
      country?: ReturnType<typeof CountryComponent.build>;
    } = {
      phonePrefixId: phonePrefix.phonePrefixId,
      prefix: phonePrefix.prefix,
      countryId: phonePrefix.countryId,
      isActive: phonePrefix.isActive,
      createdAt: phonePrefix.createdAt,
      updatedAt: phonePrefix.updatedAt
    };

    if (includeCountry && phonePrefix.country) {
      dto.country = CountryComponent.build(phonePrefix.country);
    }

    return dto;
  }
}

// ============================================================
// GENDER
// ============================================================

class GenderComponent {
  static build(gender: Maybe<GenderRow>) {
    if (!gender) {
      return null;
    }
    return {
      genderId: gender.genderId,
      name: gender.name,
      isActive: gender.isActive,
      createdAt: gender.createdAt,
      updatedAt: gender.updatedAt
    };
  }
}

// ============================================================
// ROLE
// ============================================================

class RoleComponent {
  static build(role: Maybe<RoleRow>) {
    if (!role) {
      return null;
    }
    return {
      roleId: role.roleId,
      name: role.name,
      description: role.description || null,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt
    };
  }
}

// ============================================================
// AVATAR THEME
// ============================================================

class AvatarThemeComponent {
  static build(theme: Maybe<AvatarThemeRow>) {
    if (!theme) {
      return null;
    }
    return {
      avatarThemeId: theme.avatarThemeId,
      name: theme.name,
      isActive: theme.isActive,
      createdAt: theme.createdAt,
      updatedAt: theme.updatedAt
    };
  }
}

// ============================================================
// AVATAR
// ============================================================

class AvatarComponent {
  /**
   * @param includeTheme Incluir asociación theme (alias `avatar.theme`)
   */
  static build(avatar: Maybe<AvatarRow>, includeTheme = false) {
    if (!avatar) {
      return null;
    }

    const dto: {
      avatarId: string;
      name: Maybe<string>;
      imageUrl: string | null;
      avatarThemeId: Maybe<string>;
      isActive: Maybe<boolean>;
      createdAt: Maybe<DbDate>;
      updatedAt: Maybe<DbDate>;
      theme?: ReturnType<typeof AvatarThemeComponent.build>;
    } = {
      avatarId: avatar.avatarId,
      name: avatar.name,
      imageUrl: avatar.imageUrl || null,
      avatarThemeId: avatar.avatarThemeId,
      isActive: avatar.isActive,
      createdAt: avatar.createdAt,
      updatedAt: avatar.updatedAt
    };

    if (includeTheme && avatar.theme) {
      dto.theme = AvatarThemeComponent.build(avatar.theme);
    }

    return dto;
  }
}

// ============================================================
// ESQUEMAS DE SALIDA — describen (y documentan) lo que arman los componentes de arriba
// ============================================================

const catalogBase = {
  name: z.string().nullish(),
  isActive: z.boolean().nullish(),
  createdAt: dateTime().nullish(),
  updatedAt: dateTime().nullish()
};

export const CountrySchema = z.object({
  countryId: z.uuid(),
  code: z.string().nullish().meta({ example: 'CO' }),
  iconUrl: z.string().nullable(),
  ...catalogBase
});
export const DepartmentSchema = z.object({
  departmentId: z.uuid(),
  daneCode: z.string().nullable(),
  countryId: z.string().nullish(),
  country: CountrySchema.nullable().optional(),
  ...catalogBase
});
export const CitySchema = z.object({
  cityId: z.uuid(),
  daneCode: z.string().nullable(),
  departmentId: z.string().nullish(),
  department: DepartmentSchema.nullable().optional(),
  ...catalogBase
});
export const PhonePrefixSchema = z.object({
  phonePrefixId: z.uuid(),
  prefix: z.string().nullish().meta({ example: '+57' }),
  countryId: z.string().nullish(),
  country: CountrySchema.nullable().optional(),
  isActive: catalogBase.isActive,
  createdAt: catalogBase.createdAt,
  updatedAt: catalogBase.updatedAt
});
export const GenderSchema = z.object({ genderId: z.uuid(), ...catalogBase });
export const RoleSchema = z.object({ roleId: z.uuid(), description: z.string().nullable(), ...catalogBase });
export const AvatarThemeSchema = z.object({ avatarThemeId: z.uuid(), ...catalogBase });
export const AvatarSchema = z.object({
  avatarId: z.uuid(),
  imageUrl: z.string().nullable(),
  avatarThemeId: z.string().nullish(),
  theme: AvatarThemeSchema.nullable().optional(),
  ...catalogBase
});

// ============================================================
// EXPORTS
// ============================================================

export default {
  // Catálogo geográfico
  CountryComponent,
  DepartmentComponent,
  CityComponent,
  PhonePrefixComponent,

  // Catálogo de persona
  GenderComponent,

  // Catálogo de sistema
  RoleComponent,
  AvatarThemeComponent,
  AvatarComponent
};
