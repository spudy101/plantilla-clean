// Mappers fila de Prisma → entidades de person. Es el único lugar que conoce las dos formas: si cambia el
// esquema de la base, cambia esto y no el dominio. Los hashes de búsqueda (national_id_hash, email_hash…) y
// los campos de origen (origin_session_id) no salen de la infraestructura.
//
// La PII ya llega en claro: la descifra la extensión de Prisma (shared/infrastructure/database/prisma-extensions).
import type {
  City,
  Country,
  Department,
  Person as PersonRow,
  PersonContact as PersonContactRow,
  PersonLocation as PersonLocationRow,
  PersonReference as PersonReferenceRow,
  PhonePrefix
} from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { Person } from '../../domain/person';
import type { PersonContact, PersonContactWithPrefixes } from '../../domain/person-contact';
import type { PersonLocationWithPlaces } from '../../domain/person-location';
import type { PersonReference } from '../../domain/person-reference';

type PrefixRef = Pick<PhonePrefix, 'prefix'> | null;

export interface PersonContactRowWithPrefixes extends PersonContactRow {
  phonePrimaryPrefix: PrefixRef;
  phoneSecondaryPrefix: PrefixRef;
}

export interface PersonLocationRowWithPlaces extends PersonLocationRow {
  country: Country | null;
  department: Department;
  city: City;
}

export const PersonMapper = {
  personToDomain(row: PersonRow): Person {
    return {
      personId: row.personId,
      firstName: row.firstName,
      middleName: row.middleName,
      lastName: row.lastName,
      secondLastName: row.secondLastName,
      nationalId: row.nationalId,
      documentTypeId: row.documentTypeId,
      birthDate: row.birthDate,
      genderId: row.genderId,
      countryId: row.countryId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  },

  contactToDomain(row: PersonContactRow): PersonContact {
    return {
      personContactId: row.personContactId,
      personId: row.personId,
      email: row.email,
      emailVerifiedAt: row.emailVerifiedAt,
      phonePrimary: row.phonePrimary,
      phonePrimaryPrefixId: row.phonePrimaryPrefixId,
      phonePrimaryVerifiedAt: row.phonePrimaryVerifiedAt,
      phoneSecondary: row.phoneSecondary,
      phoneSecondaryPrefixId: row.phoneSecondaryPrefixId,
      phoneSecondaryVerifiedAt: row.phoneSecondaryVerifiedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  },

  contactWithPrefixesToDomain(row: PersonContactRowWithPrefixes): PersonContactWithPrefixes {
    return {
      ...PersonMapper.contactToDomain(row),
      phonePrimaryPrefix: row.phonePrimaryPrefix ? { prefix: row.phonePrimaryPrefix.prefix } : null,
      phoneSecondaryPrefix: row.phoneSecondaryPrefix ? { prefix: row.phoneSecondaryPrefix.prefix } : null
    };
  },

  locationWithPlacesToDomain(row: PersonLocationRowWithPlaces): PersonLocationWithPlaces {
    return {
      personLocationId: row.personLocationId,
      personId: row.personId,
      countryId: row.countryId,
      departmentId: row.departmentId,
      cityId: row.cityId,
      address: row.address,
      postalCode: row.postalCode,
      type: row.type,
      country: row.country
        ? { countryId: row.country.countryId, name: row.country.name, code: row.country.code, iconUrl: row.country.iconUrl }
        : null,
      department: { departmentId: row.department.departmentId, name: row.department.name, daneCode: row.department.daneCode },
      city: { cityId: row.city.cityId, name: row.city.name, daneCode: row.city.daneCode }
    };
  },

  referenceToDomain(row: PersonReferenceRow): PersonReference {
    return {
      personReferenceId: row.personReferenceId,
      personId: row.personId,
      referenceName: row.referenceName,
      referencePhone: row.referencePhone,
      referenceType: row.referenceType,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
};
