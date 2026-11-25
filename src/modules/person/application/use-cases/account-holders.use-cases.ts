// Caso de uso compartido: la persona detrás de una cuenta que crea iam (el registro de un cliente, el alta de un
// usuario interno) y lo que iam necesita saber de ella (si el email o el documento ya están tomados, de quién es un
// email, cambiarle los nombres). Lo usa iam por el adaptador de src/main/; las escrituras corren dentro de la unidad
// de trabajo de quien llama.
import type { NewPerson } from '../../domain/person';
import type { PersonContactRepository } from '../ports/person-contact-repository.port';
import type { PersonRepository } from '../ports/person-repository.port';

export class AccountHolders {
  constructor(
    private readonly persons: PersonRepository,
    private readonly contacts: PersonContactRepository
  ) {}

  /** Persona y contacto, en ese orden. */
  async create(person: NewPerson, contact: { email: string; emailVerifiedAt: Date }) {
    const created = await this.persons.create(person);
    const createdContact = await this.contacts.create({ personId: created.personId, ...contact });
    return { person: created, contact: createdContact };
  }

  async emailInUse(email: string): Promise<boolean> {
    return (await this.contacts.findByEmail(email)) !== null;
  }

  async nationalIdInUse(nationalId: string): Promise<boolean> {
    return (await this.persons.findByNationalId(nationalId)) !== null;
  }

  /** La persona dueña del email, si alguna. */
  async findByEmail(email: string): Promise<{ personId: string; firstName: string } | null> {
    const contact = await this.contacts.findByEmail(email);
    const person = contact ? await this.persons.findById(contact.personId) : null;
    return person ? { personId: person.personId, firstName: person.firstName } : null;
  }

  async updateNames(personId: string, names: { firstName: string; middleName: string | null; lastName: string; secondLastName: string | null }) {
    await this.persons.update(personId, names);
  }
}
