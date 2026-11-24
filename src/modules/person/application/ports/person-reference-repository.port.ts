// Puerto: las referencias personales (tabla person_references; se borran de forma lógica).
import type { PersonReference, ReferenceData } from '../../domain/person-reference';

export interface PersonReferenceRepository {
  /** Las referencias vigentes de la persona, de la más vieja a la más nueva. */
  listActive(personId: string): Promise<PersonReference[]>;
  /** Una referencia vigente de la persona. */
  findActive(personReferenceId: string, personId: string): Promise<PersonReference | null>;
  create(personId: string, data: ReferenceData): Promise<PersonReference>;
  /** Actualiza lo que llega; null si la fila ya no existe. */
  update(personReferenceId: string, changes: Partial<ReferenceData>): Promise<PersonReference | null>;
  deactivate(personReferenceId: string): Promise<void>;
}
