// Puerto: el contacto de cada persona (tabla person_contacts). Email y teléfonos se buscan por su hash: eso
// lo resuelve el adaptador.
import type { ContactChanges, NewPersonContact, PersonContact, PersonContactWithPrefixes } from '../../domain/person-contact';

export interface PersonContactRepository {
  findByPersonId(personId: string): Promise<PersonContact | null>;
  /** El contacto con el prefijo de cada teléfono (para mostrarlo). */
  findByPersonIdWithPrefixes(personId: string): Promise<PersonContactWithPrefixes | null>;
  findByEmail(email: string): Promise<PersonContact | null>;
  findByPrimaryPhone(phone: string): Promise<PersonContact | null>;
  findBySecondaryPhone(phone: string): Promise<PersonContact | null>;
  create(data: NewPersonContact): Promise<PersonContact>;
  update(personContactId: string, changes: ContactChanges): Promise<void>;
}
