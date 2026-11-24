// Eliminación de una cuenta (derecho de supresión, Ley 1581/2012): no se borran filas, se ofuscan.
//
// El documento, el username, el email y los teléfonos se reemplazan por valores que no identifican a nadie
// pero siguen siendo únicos (llevan la marca de tiempo); los nombres quedan en ELIMINADO y la dirección se
// borra (departamento y ciudad se conservan para estadística agregada).
import type { PersonChanges } from './person';
import type { ContactChanges, PersonContact } from './person-contact';

const KEPT_PREFIX_LENGTH = 4;
const KEPT_PHONE_SUFFIX_LENGTH = 4;

export const DELETED_NAME = 'ELIMINADO';
export const DELETED_ADDRESS = 'ELIMINADO';

/** deleted_<timestamp>_<primeros 4 caracteres> */
export function deletedNationalId(nationalId: string | null | undefined, at: Date): string {
  return `deleted_${at.getTime()}_${(nationalId || 'unknown').slice(0, KEPT_PREFIX_LENGTH)}`;
}

/** deleted_<timestamp>_<primeros 4 caracteres> */
export function deletedUsername(username: string | null | undefined, at: Date): string {
  return `deleted_${at.getTime()}_${(username || 'unknown').slice(0, KEPT_PREFIX_LENGTH)}`;
}

/** deleted_<timestamp>@deleted.invalid */
export function deletedEmail(at: Date): string {
  return `deleted_${at.getTime()}@deleted.invalid`;
}

/** 0000000000<últimos 4 dígitos del timestamp> */
export function deletedPhone(at: Date): string {
  return `0000000000${String(at.getTime()).slice(-KEPT_PHONE_SUFFIX_LENGTH)}`;
}

export interface AccountAnonymization {
  person: PersonChanges;
  username: string;
  contact: ContactChanges;
}

/** Cómo quedan la persona, el usuario y el contacto de una cuenta eliminada en `at`. */
export function anonymizeAccount(
  { nationalId, username, contact }: { nationalId: string | null; username: string; contact: Pick<PersonContact, 'phonePrimary' | 'phoneSecondary'> },
  at: Date
): AccountAnonymization {
  const contactChanges: ContactChanges = { email: deletedEmail(at) };
  if (contact.phonePrimary) {
    contactChanges.phonePrimary = deletedPhone(at);
  }
  if (contact.phoneSecondary) {
    contactChanges.phoneSecondary = deletedPhone(at);
  }
  return {
    person: {
      nationalId: deletedNationalId(nationalId, at),
      firstName: DELETED_NAME,
      lastName: DELETED_NAME,
      middleName: null,
      secondLastName: null,
      birthDate: null
    },
    username: deletedUsername(username, at),
    contact: contactChanges
  };
}
