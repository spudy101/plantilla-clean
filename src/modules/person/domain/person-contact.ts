// El contacto de una persona: un email y hasta dos teléfonos, cada uno con su fecha de verificación.
//
// Email y teléfonos van cifrados en reposo y se buscan por su hash; acá siempre están en claro.
import { SameEmailError } from './errors';

export type PhoneType = 'primary' | 'secondary';

export interface PersonContact {
  personContactId: string;
  personId: string;
  email: string;
  emailVerifiedAt: Date | null;
  phonePrimary: string | null;
  phonePrimaryPrefixId: string | null;
  phonePrimaryVerifiedAt: Date | null;
  phoneSecondary: string | null;
  phoneSecondaryPrefixId: string | null;
  phoneSecondaryVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** El contacto con el prefijo de cada teléfono (lo que se muestra). */
export interface PersonContactWithPrefixes extends PersonContact {
  phonePrimaryPrefix: { prefix: string | null } | null;
  phoneSecondaryPrefix: { prefix: string | null } | null;
}

export interface NewPersonContact {
  personId: string;
  email: string;
  emailVerifiedAt?: Date | null;
}

export type ContactChanges = Partial<Omit<PersonContact, 'personContactId' | 'personId' | 'createdAt' | 'updatedAt'>>;

export function phoneOf(contact: PersonContact, type: PhoneType): string | null {
  return type === 'primary' ? contact.phonePrimary : contact.phoneSecondary;
}

/** Un teléfono nuevo queda verificado en el momento (el OTP ya se confirmó). */
export function phoneChanges(phone: string, phonePrefixId: string, type: PhoneType, verifiedAt: Date): ContactChanges {
  return type === 'primary'
    ? { phonePrimary: phone, phonePrimaryPrefixId: phonePrefixId, phonePrimaryVerifiedAt: verifiedAt }
    : { phoneSecondary: phone, phoneSecondaryPrefixId: phonePrefixId, phoneSecondaryVerifiedAt: verifiedAt };
}

/** Un email nuevo queda verificado en el momento. Cambiarlo por el mismo no es un cambio. */
export function emailChanges(contact: PersonContact, newEmail: string, verifiedAt: Date): ContactChanges {
  if (contact.email === newEmail) {
    throw new SameEmailError();
  }
  return { email: newEmail, emailVerifiedAt: verifiedAt };
}

/** Si un email o teléfono lo tiene otra persona (el de la propia persona no cuenta). */
export function belongsToAnother(contact: Pick<PersonContact, 'personId'> | null, personId: string | null): boolean {
  return contact !== null && contact.personId !== personId;
}
