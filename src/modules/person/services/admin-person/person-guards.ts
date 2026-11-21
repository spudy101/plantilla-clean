import rbacModule from '../../../../shared/domain/constants/rbac';
const { CLIENT_ROLE_NAMES } = rbacModule;
// modules/admin/kyc/person/services/admin-person/person-guards.ts
//
// Reglas de negocio compartidas por los servicios de administración de personas.
import AppError from '../../../../shared/presentation/http/app-error.util';

/**
 * Bloquea toda operación de escritura sobre una cuenta eliminada (deleted_at != null).
 * Las cuentas eliminadas son intocables: no se reactivan, no cambian de rol, no se editan, etc.
 * @param {object|null} user
 */
function assertNotDeleted(user: { deletedAt?: Date | null } | null | undefined) {
  if (user?.deletedAt) {
    throw AppError.conflict('La cuenta está eliminada y no admite modificaciones', { code: 'USER_DELETED' });
  }
}

/**
 * Persona asociada al usuario (person_id es NOT NULL: siempre existe). Si falta, el include no la
 * trajo: error explícito en vez de un TypeError al leer sus campos.
 */
function requirePerson<P>(user: { person?: P | null }): P {
  if (!user.person) {
    throw AppError.internal('Usuario sin persona asociada');
  }
  return user.person;
}

/** Roles de cliente: los únicos que gestiona el módulo de personas (los internos van por admin-user). */
function isClientRole(roleName: string | null | undefined): boolean {
  return Boolean(roleName) && (CLIENT_ROLE_NAMES as readonly string[]).includes(roleName as string);
}

export default { assertNotDeleted, requirePerson, isClientRole };
