// Puertos: la persona detrás de cada cuenta, que es de person. iam la crea al registrar un cliente o dar de alta un
// usuario interno, revisa que el documento y el email no estén tomados, le cambia los nombres y, al eliminar un
// usuario interno, le pide a person la baja (ofuscación) de la cuenta.
//
// Los implementa src/main/adapters/iam-sources.adapter.ts con los casos de uso de person.
import type { PersonRef } from '../../domain/user';

export interface NewAccountHolder {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  secondLastName?: string | null;
  nationalId: string;
  documentTypeId?: string | null;
  /** Date, o el texto ISO que llega en el registro. */
  birthDate?: Date | string | null;
  genderId?: string | null;
  countryId?: string | null;
}

/** La persona y el contacto recién creados (lo que muestra la respuesta del registro). */
export interface CreatedAccountHolder {
  person: Omit<PersonRef, 'contact'>;
  contact: NonNullable<PersonRef['contact']>;
}

export interface AccountHolders {
  /** Persona + contacto (con el email ya verificado). Corre dentro de la unidad de trabajo de quien llama. */
  create(holder: NewAccountHolder, contact: { email: string; emailVerifiedAt: Date }): Promise<CreatedAccountHolder>;
  emailInUse(email: string): Promise<boolean>;
  nationalIdInUse(nationalId: string): Promise<boolean>;
  /** La persona dueña del email, si alguna. */
  findByEmail(email: string): Promise<{ personId: string; firstName: string } | null>;
  updateNames(
    personId: string,
    names: { firstName: string; middleName: string | null; lastName: string; secondLastName: string | null }
  ): Promise<void>;
}

/** Unicidad del documento y el email (con los mensajes de person). */
export interface IdentityChecks {
  assertNationalIdAvailable(nationalId: string): Promise<void>;
  assertEmailAvailable(email: string): Promise<void>;
}

/** La baja de una cuenta (derecho de supresión): ofusca persona, contacto y usuario. */
export interface AccountAnonymizer {
  anonymize(input: {
    userId: string;
    personId: string;
    nationalId: string | null;
    email?: string | null;
    username: string;
    firstName?: string | null;
    changedBy: { userId: string; role: 'admin' | 'user' };
    changeReason: string;
  }): Promise<void>;
}

/** Contraseñas temporales seguras (alta de usuarios internos). */
export interface TemporaryPasswords {
  generate(): string;
}
