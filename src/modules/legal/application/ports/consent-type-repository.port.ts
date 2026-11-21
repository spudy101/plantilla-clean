// Puerto de persistencia de los tipos de consentimiento: lo que los casos de uso necesitan, en términos de
// la entidad. Lo implementa infrastructure/persistence/prisma-consent-type.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { ConsentType, ConsentTypeChanges, NewConsentType } from '../../domain/consent-type';

export interface ConsentTypePage {
  rows: ConsentType[];
  count: number;
}

export interface ConsentTypeRepository {
  findById(consentTypeId: string): Promise<ConsentType | null>;

  /** El tipo ACTIVO con ese código (los inactivos no se otorgan ni se exigen). */
  findActiveByCode(code: string): Promise<ConsentType | null>;

  /** Si ya hay un tipo con ese código, activo o no (el código es único). */
  existsWithCode(code: string): Promise<boolean>;

  /** Los tipos activos, por nombre. */
  listActive(): Promise<ConsentType[]>;

  /** Listado paginado de todos los tipos, con búsqueda por nombre, código o descripción. */
  list(page: PageRequest, search: string | null): Promise<ConsentTypePage>;

  create(consentType: NewConsentType): Promise<ConsentType>;

  /** null si el tipo dejó de existir entre la lectura y la escritura. */
  update(consentTypeId: string, changes: ConsentTypeChanges): Promise<ConsentType | null>;
}
