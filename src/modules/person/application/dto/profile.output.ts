// Salidas del perfil propio: el perfil (cuenta + persona + contacto + ubicación + consentimientos) y las
// confirmaciones de cada cambio.
import MaskingUtil from '../../../../shared/domain/pii/masking.util';
import type { ClientAccount } from '../../domain/client-account';
import type { PhoneType } from '../../domain/person-contact';
import type { Person } from '../../domain/person';
import type { ConsentCatalogItem } from '../ports/profile-consents.port';
import { toContactOutput, toLocationOutput, toPersonOutput, toUserOutput } from '../../../../shared/application/account-views';

export interface ProfileOutput {
  user: ReturnType<typeof toUserOutput>;
  person?: ReturnType<typeof toPersonOutput>;
  contact?: ReturnType<typeof toContactOutput>;
  location?: ReturnType<typeof toLocationOutput>;
  consents?: ConsentCatalogItem[];
}

/** El perfil de la cuenta; `consents` es el catálogo de consentimientos con el estado del titular. */
export function toProfileOutput(account: ClientAccount, consents: ConsentCatalogItem[] = []): ProfileOutput {
  const dto: ProfileOutput = { user: toUserOutput(account, { includeRole: true, includeAvatar: true }) };
  const { person } = account;
  if (person) {
    dto.person = toPersonOutput(person, { includeGender: true, includeNationality: true, includeDocumentType: true });
    if (person.contact) {
      dto.contact = toContactOutput(person.contact);
    }
    if (person.location) {
      dto.location = toLocationOutput(person.location);
    }
  }
  dto.consents = consents;
  return dto;
}

// Confirmaciones: el dato sale enmascarado (el titular acaba de escribirlo; no hace falta repetirlo).
export function toEmailUpdatedOutput(newEmail: string, updatedAt: Date) {
  return { newEmail: MaskingUtil.maskEmail(newEmail) || null, updatedAt };
}

export function toPhoneUpdatedOutput(phone: string, phonePrefixId: string, phoneType: PhoneType, updatedAt: Date) {
  return { phoneType, phone: MaskingUtil.maskPhone(phone) || null, phonePrefixId, updatedAt };
}

export function toNamesUpdatedOutput(person: Pick<Person, 'personId' | 'firstName' | 'middleName' | 'lastName' | 'secondLastName' | 'updatedAt'>) {
  return {
    personId: person.personId,
    firstName: person.firstName,
    middleName: person.middleName ?? null,
    lastName: person.lastName,
    secondLastName: person.secondLastName ?? null,
    updatedAt: person.updatedAt
  };
}
