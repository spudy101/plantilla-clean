// Entidades a las que se atribuyen los eventos de auditoría de person, y quién hace un cambio.
import type { PageQuery } from '../../../../shared/application/pagination';

export const USER_AUDIT_ENTITY = { entityType: 'User', entityTable: 'users' } as const;
export const ROLE_AUDIT_ENTITY = { entityType: 'RbacRole', entityTable: 'roles' } as const;
export const REFERENCE_AUDIT_ENTITY = { entityType: 'PersonReference', entityTable: 'person_references' } as const;

/** Quién hace un cambio sobre una cuenta: el propio titular o un administrador. */
export interface ChangeActor {
  userId: string;
  role: 'admin' | 'user';
}

/** Entrada de un listado: la página pedida (sortBy y order ya validados por la presentación) y la búsqueda. */
export type ListQuery = PageQuery & { search?: string | null };
