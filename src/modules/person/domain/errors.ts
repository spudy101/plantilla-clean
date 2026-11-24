// Errores del dominio person. Los mensajes y códigos son los que respondía la plantilla en capas (el contrato
// de la API no cambia); la presentación decide el status HTTP por la familia del error.
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../shared/domain/errors/domain-error';

// ── No encontrado ──────────────────────────────────────────────
export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('Usuario no encontrado', 'NOT_FOUND');
  }
}

export class AdminNotFoundError extends NotFoundError {
  constructor() {
    super('Administrador no encontrado', 'NOT_FOUND');
  }
}

export class PersonNotFoundError extends NotFoundError {
  constructor() {
    super('Persona no encontrada', 'NOT_FOUND');
  }
}

/** Falta el contacto de una persona al cambiar sus datos. */
export class ContactNotFoundError extends NotFoundError {
  constructor() {
    super('Contacto de la persona no encontrado', 'NOT_FOUND');
  }
}

/** El titular pide ver su contacto y no tiene. */
export class ContactInfoNotFoundError extends NotFoundError {
  constructor() {
    super('Informacion de contacto no encontrada', 'NOT_FOUND');
  }
}

export class ReferenceNotFoundError extends NotFoundError {
  constructor() {
    super('Referencia no encontrada', 'NOT_FOUND');
  }
}

export class RoleNotFoundError extends NotFoundError {
  constructor() {
    super('Rol no encontrado', 'NOT_FOUND');
  }
}

// ── Catálogos ──────────────────────────────────────────────────
/** Un valor de catálogo que no existe (404) o que existe pero está inactivo (400). */
export class CatalogEntryNotFoundError extends NotFoundError {}
export class CatalogEntryUnavailableError extends InvalidInputError {}

export const catalogErrors = {
  avatar: { notFound: 'Avatar no encontrado', unavailable: 'Avatar no disponible' },
  gender: { notFound: 'Gender no encontrado', unavailable: 'Gender no disponible' },
  documentType: { notFound: 'Tipo de documento no encontrado', unavailable: 'Tipo de documento no disponible' }
} as const;

export class DepartmentNotFoundError extends NotFoundError {
  constructor() {
    super('El departamento especificado no existe', 'NOT_FOUND');
  }
}

export class CityNotFoundError extends NotFoundError {
  constructor() {
    super('La ciudad especificada no existe', 'NOT_FOUND');
  }
}

export class CityOutsideDepartmentError extends InvalidInputError {
  constructor() {
    super('La ciudad no pertenece al departamento especificado', 'BAD_REQUEST');
  }
}

// ── Credenciales y datos de contacto ───────────────────────────
export class WrongCurrentPasswordError extends InvalidInputError {
  constructor() {
    super('Contraseña actual incorrecta', 'BAD_REQUEST');
  }
}

/** El email o el teléfono nuevo no pasó por la verificación OTP. */
export class ContactNotVerifiedError extends ForbiddenError {
  constructor(kind: 'email' | 'phone') {
    super(
      kind === 'email'
        ? 'El email debe estar verificado antes de poder actualizarlo'
        : 'El teléfono debe estar verificado antes de poder actualizarlo',
      'FORBIDDEN'
    );
  }
}

export class EmailTakenError extends ConflictError {
  constructor() {
    super('El email ya está en uso por otro usuario', 'CONFLICT');
  }
}

export class PhoneTakenError extends ConflictError {
  constructor() {
    super('El teléfono ya está en uso por otro usuario', 'CONFLICT');
  }
}

export class NationalIdTakenError extends ConflictError {
  constructor() {
    super('El National ID ya está registrado', 'CONFLICT');
  }
}

export class UsernameTakenError extends ConflictError {
  constructor() {
    super('El username ya está en uso', 'CONFLICT');
  }
}

export class SameEmailError extends InvalidInputError {
  constructor() {
    super('El nuevo email es igual al actual', 'BAD_REQUEST');
  }
}

/** El documento no cumple el formato que exige el rol de la cuenta. */
export class InvalidNationalIdError extends InvalidInputError {
  constructor(message: string) {
    super(message, 'BAD_REQUEST');
  }
}

// ── Cuentas de cliente (panel admin) ───────────────────────────
export class AccountDeletedError extends ConflictError {
  constructor() {
    super('La cuenta está eliminada y no admite modificaciones', 'CONFLICT', { code: 'USER_DELETED' });
  }
}

export class AccountStatusUnchangedError extends InvalidInputError {
  constructor(isActive: boolean) {
    super(`El usuario ya está ${isActive ? 'activo' : 'inactivo'}`, 'BAD_REQUEST');
  }
}

export class NotAClientAccountError extends ForbiddenError {
  constructor() {
    super('Solo se puede cambiar el rol de una cuenta de cliente', 'FORBIDDEN');
  }
}

export class NotAClientRoleError extends InvalidInputError {
  constructor() {
    super('El rol indicado no es un rol de cliente', 'BAD_REQUEST');
  }
}

export class SameRoleError extends InvalidInputError {
  constructor() {
    super('El usuario ya tiene este rol', 'BAD_REQUEST');
  }
}

export class MfaNotEnabledError extends InvalidInputError {
  constructor() {
    super('El usuario no tiene MFA habilitado', 'BAD_REQUEST');
  }
}

// ── Referencias ────────────────────────────────────────────────
export class ReferenceLimitReachedError extends InvalidInputError {
  constructor(max: number) {
    super(`No puede agregar más de ${max} referencias`, 'BAD_REQUEST');
  }
}

// ── Errores de programación / datos (no son reglas del negocio: responden 500) ──
/** La persona es NOT NULL en users: si falta, la lectura no la trajo. */
export class AccountWithoutPersonError extends Error {
  constructor() {
    super('Usuario sin persona asociada');
    this.name = 'AccountWithoutPersonError';
  }
}

/** El rol de cliente no está sembrado. */
export class ClientRoleNotConfiguredError extends Error {
  constructor(roleName: string) {
    super(`Rol ${roleName} no configurado. Ejecuta el seeder RBAC.`);
    this.name = 'ClientRoleNotConfiguredError';
  }
}

export class CreatedAccountNotFoundError extends Error {
  constructor() {
    super('Usuario recién creado no encontrado');
    this.name = 'CreatedAccountNotFoundError';
  }
}
