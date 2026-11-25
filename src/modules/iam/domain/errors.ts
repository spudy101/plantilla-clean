// Errores del dominio iam. Los mensajes, códigos y detalles son los que respondía la plantilla en capas (el
// contrato de la API no cambia); la presentación decide el status HTTP por la familia del error.
//
// iam tiene muchos rechazos distintos (credenciales, sesiones, dispositivos, MFA, biometría, usuarios internos):
// cada familia lleva su mensaje, y los que se repiten o tienen un código propio (sesión cerrada, dispositivo
// bloqueado, MFA obligatorio) tienen su clase.
import AUTH_ERROR_CODES from '../../../shared/domain/constants/auth-error-codes';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  InvalidInputError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError
} from '../../../shared/domain/errors/domain-error';

type Details = Record<string, unknown> | null;

// ── Familias (mismos códigos que AppError) ─────────────────────
/** 400 — el dato no sirve (credenciales, códigos, estado que no admite la acción). */
export class IamInvalidInputError extends InvalidInputError {
  constructor(message: string, details: Details = null) {
    super(message, 'BAD_REQUEST', details);
  }
}

/** 401 — no se sabe quién es o su credencial no vale. */
export class IamUnauthorizedError extends UnauthorizedError {
  constructor(message = 'No autorizado', details: Details = null) {
    super(message, 'UNAUTHORIZED', details);
  }
}

/** 403 — se sabe quién es, pero no puede hacerlo. */
export class IamForbiddenError extends ForbiddenError {
  constructor(message = 'Acceso denegado', details: Details = null) {
    super(message, 'FORBIDDEN', details);
  }
}

/** 404 — lo que se busca no existe (o no es de quien pregunta). */
export class IamNotFoundError extends NotFoundError {
  constructor(message = 'Recurso no encontrado', details: Details = null) {
    super(message, 'NOT_FOUND', details);
  }
}

/** 409 — ya existe o ya está en ese estado. */
export class IamConflictError extends ConflictError {
  constructor(message: string, details: Details = null) {
    super(message, 'CONFLICT', details);
  }
}

/** 429 — hay que esperar `retryAfterSeconds` antes de volver a intentarlo. */
export class IamRateLimitedError extends TooManyRequestsError {
  constructor(message: string, retryAfterSeconds: number | null) {
    super(message, 'RATE_LIMIT', retryAfterSeconds);
  }
}

/** 500 — falta un dato de referencia que debería existir (seeders) o una escritura no se completó. */
export class IamInternalError extends InternalError {
  constructor(message: string) {
    super(message, 'INTERNAL_ERROR');
  }
}

// ── Los que se repiten ─────────────────────────────────────────
export class UserNotFoundError extends IamNotFoundError {
  constructor() {
    super('Usuario no encontrado');
  }
}

export class DeviceNotFoundError extends IamNotFoundError {
  constructor() {
    super('Dispositivo no encontrado');
  }
}

export class SessionNotFoundError extends IamNotFoundError {
  constructor() {
    super('Sesión no encontrada');
  }
}

export class InactiveAccountError extends IamForbiddenError {
  constructor() {
    super('Cuenta inactiva o suspendida');
  }
}

/** La sesión ya no vale (logout, revocación, rotación): el front debe mandar a login. */
export class SessionClosedError extends IamUnauthorizedError {
  constructor(message = 'La sesión ha sido cerrada. Por favor inicia sesión nuevamente.') {
    super(message, { code: AUTH_ERROR_CODES.SESSION_CLOSED });
  }
}

/** El dispositivo desde el que se pide está bloqueado. */
export class DeviceBlockedError extends IamForbiddenError {
  constructor(code: string | null = AUTH_ERROR_CODES.DEVICE_BLOCKED) {
    super('Este dispositivo ha sido bloqueado. Desbloquéalo desde otro dispositivo de confianza.', code ? { code } : null);
  }
}

/** RF-ADM-01 #6: los roles internos deben tener 2FA activo para operar. */
export class MfaRequiredError extends IamForbiddenError {
  constructor() {
    super('Debes activar la autenticación de dos factores (2FA) para realizar esta acción', { code: 'MFA_REQUIRED' });
  }
}

/** Una cuenta eliminada (deleted_at) no admite modificaciones. */
export class UserDeletedError extends IamConflictError {
  constructor() {
    super('El usuario está eliminado y no admite modificaciones', { code: 'USER_DELETED' });
  }
}

/** Challenge biométrico inexistente, vencido o ya consumido (replay). */
export class InvalidBiometricChallengeError extends IamInvalidInputError {
  constructor() {
    super('Challenge inválido, expirado o ya utilizado');
  }
}

export { AUTH_ERROR_CODES };

/** La lectura no trajo la persona de la cuenta (person_id es NOT NULL): es un defecto, no una regla. */
export class AccountWithoutPersonError extends Error {
  constructor() {
    super('Usuario sin persona asociada');
    this.name = 'AccountWithoutPersonError';
  }
}
