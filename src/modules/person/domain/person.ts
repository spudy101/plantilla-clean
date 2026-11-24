// La persona detrás de una cuenta: nombres, documento, nacimiento, género y país.
//
// El documento (national_id) va cifrado en reposo; acá siempre está en claro (lo descifra la infraestructura).
import { InvalidNationalIdError } from './errors';

export interface PersonNames {
  firstName: string;
  middleName: string | null;
  lastName: string;
  secondLastName: string | null;
}

export interface Person extends PersonNames {
  personId: string;
  nationalId: string | null;
  documentTypeId: string | null;
  birthDate: Date | null;
  genderId: string | null;
  countryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Alta de una persona (los ids, fechas y hashes los pone la base). */
export interface NewPerson {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  secondLastName?: string | null;
  nationalId: string;
  documentTypeId?: string | null;
  /** Date, o el texto ISO que manda iam al registrar. */
  birthDate?: Date | string | null;
  genderId?: string | null;
  countryId?: string | null;
}

/** Cambios sobre una persona: solo las claves presentes se escriben. */
export type PersonChanges = Partial<Omit<Person, 'personId' | 'createdAt' | 'updatedAt'>>;

/** "Nombre segundo-nombre apellido segundo-apellido", sin las partes vacías. */
export function fullNameOf(names: Partial<PersonNames> | null | undefined): string {
  return [names?.firstName, names?.middleName, names?.lastName, names?.secondLastName].filter(Boolean).join(' ');
}

export interface NamesInput {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  secondLastName?: string | null;
}

/**
 * Los nombres que cambian. `firstName` y `lastName` son obligatorios en la persona; los segundos aceptan
 * null (o '') para limpiarse. Solo aparecen las claves presentes en `input`.
 */
export function namesChanges(input: NamesInput): Partial<PersonNames> {
  const changes: Partial<PersonNames> = {};
  if (input.firstName !== undefined) {
    changes.firstName = input.firstName;
  }
  if (input.lastName !== undefined) {
    changes.lastName = input.lastName;
  }
  if (input.middleName !== undefined) {
    changes.middleName = input.middleName === '' ? null : input.middleName;
  }
  if (input.secondLastName !== undefined) {
    changes.secondLastName = input.secondLastName === '' ? null : input.secondLastName;
  }
  return changes;
}

/** Los nombres que quedan después de aplicar `changes`. */
export function withNames(person: PersonNames, changes: Partial<PersonNames>): PersonNames {
  return {
    firstName: changes.firstName ?? person.firstName,
    middleName: changes.middleName !== undefined ? changes.middleName : person.middleName,
    lastName: changes.lastName ?? person.lastName,
    secondLastName: changes.secondLastName !== undefined ? changes.secondLastName : person.secondLastName
  };
}

const ADMIN_NATIONAL_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * El formato que exige cada rol al documento. Un administrador usa un identificador interno (letras, números,
 * guiones); para el resto basta con que venga.
 */
export function assertNationalIdForRole(nationalId: string, roleName: string): void {
  if (!nationalId || typeof nationalId !== 'string') {
    throw new InvalidNationalIdError(roleName.toLowerCase() === 'admin' ? 'National ID debe ser un texto válido' : 'National ID es requerido');
  }
  if (roleName.toLowerCase() === 'admin' && !ADMIN_NATIONAL_ID.test(nationalId)) {
    throw new InvalidNationalIdError('National ID solo puede contener letras, números, guiones y guiones bajos');
  }
}
