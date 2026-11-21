// Errores del dominio legal. Los mensajes y códigos son los que respondía la plantilla en capas (el
// contrato de la API no cambia); la presentación decide el status HTTP por la familia del error.
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../shared/domain/errors/domain-error';

export class ConsentTypeNotFoundError extends NotFoundError {
  constructor() {
    super('Tipo de consentimiento no encontrado', 'NOT_FOUND');
  }
}

export class ConsentTypeCodeTakenError extends ConflictError {
  constructor(code: string) {
    super(`Ya existe un tipo de consentimiento con el código "${code}"`, 'CONFLICT');
  }
}

export class PrivacyPolicyNotFoundError extends NotFoundError {
  constructor() {
    super('Versión de política de privacidad no encontrada', 'NOT_FOUND');
  }
}

export class PrivacyPolicyVersionTakenError extends ConflictError {
  constructor(version: string) {
    super(`La versión ${version} ya existe`, 'CONFLICT');
  }
}

export class PolicyDocumentRequiredError extends InvalidInputError {
  constructor() {
    super('El documento PDF de la política es requerido (campo "policyDocument")', 'BAD_REQUEST');
  }
}

export class NoConsentsToGrantError extends InvalidInputError {
  constructor() {
    super('Debe proporcionar al menos un consentimiento a otorgar', 'BAD_REQUEST');
  }
}

/** Se pidió otorgar un tipo que no existe o está inactivo. */
export class UnknownConsentTypeError extends InvalidInputError {
  constructor(code: string) {
    super(`Tipo de consentimiento "${code}" no encontrado o inactivo`, 'BAD_REQUEST');
  }
}

export class ConsentNotRevocableError extends InvalidInputError {
  constructor() {
    super('Este consentimiento no puede ser revocado', 'BAD_REQUEST');
  }
}

export class NoActiveConsentToRevokeError extends NotFoundError {
  constructor() {
    super('No se encontró un consentimiento activo para revocar', 'NOT_FOUND');
  }
}

export class ConsentHistoryNotFoundError extends NotFoundError {
  constructor() {
    super('No se encontraron consentimientos para este usuario', 'NOT_FOUND');
  }
}

/** Una operación exige un tipo de consentimiento que no está configurado (o está inactivo). */
export class ConsentTypeNotConfiguredError extends ForbiddenError {
  constructor(code: string) {
    super(`El tipo de consentimiento "${code}" no está configurado`, 'FORBIDDEN', { code: 'CONSENT_TYPE_NOT_FOUND' });
  }
}

/** El usuario no tiene un consentimiento vigente del tipo que la operación exige. */
export class ConsentRequiredError extends ForbiddenError {
  constructor(consentTypeCode: string) {
    super('No se encontró un consentimiento válido y vigente para continuar con esta operación', 'FORBIDDEN', {
      code: 'CONSENT_REQUIRED',
      consentTypeCode
    });
  }
}

/**
 * Se configuró una ruta para exigir un consentimiento OPCIONAL. No es un error del usuario ni una regla que
 * se rompe en tiempo de uso: es un error de programación (por eso no es un DomainError y responde 500).
 */
export class OptionalConsentGateError extends Error {
  constructor(readonly consentTypeCode: string) {
    super(
      `ConsentMiddleware.requireConsent() no puede usarse con el tipo opcional "${consentTypeCode}". ` +
        'Los consentimientos opcionales no pueden ser condición de acceso al servicio.'
    );
    this.name = 'OptionalConsentGateError';
  }
}
