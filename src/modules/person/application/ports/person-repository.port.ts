// Puerto: las personas (tabla persons). El documento se busca por su hash: eso lo resuelve el adaptador.
import type { NewPerson, Person, PersonChanges } from '../../domain/person';

export interface PersonRepository {
  findById(personId: string): Promise<Person | null>;
  findByNationalId(nationalId: string): Promise<Person | null>;
  create(data: NewPerson): Promise<Person>;
  update(personId: string, changes: PersonChanges): Promise<void>;
}
