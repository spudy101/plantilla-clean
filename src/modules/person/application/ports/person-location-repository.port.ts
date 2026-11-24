// Puerto: la ubicación de cada persona (tabla person_locations, una por persona).
import type { LocationData, PersonLocationWithPlaces } from '../../domain/person-location';

export interface PersonLocationRepository {
  /** La ubicación con país, departamento y ciudad. */
  findByPersonId(personId: string): Promise<PersonLocationWithPlaces | null>;
  /** Crea la ubicación o reemplaza la que tenga. */
  save(personId: string, data: LocationData): Promise<void>;
  /** Borra la dirección (cuenta eliminada); departamento y ciudad se conservan. */
  eraseAddress(personId: string): Promise<void>;
}
