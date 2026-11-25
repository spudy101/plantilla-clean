// Errores del dominio: dicen QUÉ regla se rompió, no cómo se responde.
//
// El dominio y los casos de uso no conocen HTTP: lanzan uno de estos errores y la capa de presentación
// (shared/presentation/http/domain-error.mapper.ts) los traduce a un status (404, 409, 422, 403…).
// Así el mismo caso de uso sirve igual desde una ruta, un worker o un CLI.

/** Familia del error. La presentación decide qué significa en su protocolo (en HTTP: el status). */
export type DomainErrorKind =
  | 'not_found'
  | 'conflict'
  | 'rule_violation'
  | 'invalid_input'
  | 'forbidden'
  | 'unauthorized'
  | 'rate_limited';

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  /**
   * @param message mensaje para el usuario (en español)
   * @param code    código estable para el cliente (p. ej. 'SYSTEM_CONFIG_NOT_FOUND')
   * @param details datos extra que ayudan a corregir el problema
   */
  constructor(
    message: string,
    readonly code: string,
    readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Lo que se busca no existe. */
export class NotFoundError extends DomainError {
  readonly kind = 'not_found' as const;
}

/** El estado actual no permite la operación (ya existe, ya cambió, está en uso). */
export class ConflictError extends DomainError {
  readonly kind = 'conflict' as const;
}

/** Los datos son válidos en forma pero rompen una regla de negocio. */
export class RuleViolationError extends DomainError {
  readonly kind = 'rule_violation' as const;
}

/** Falta un dato o viene mal formado (lo que normalmente ya filtra la validación de entrada). */
export class InvalidInputError extends DomainError {
  readonly kind = 'invalid_input' as const;
}

/** Quien pide la operación no tiene permiso para hacerla. */
export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden' as const;
}

/** No se sabe quién pide la operación (o sus credenciales no valen). */
export class UnauthorizedError extends DomainError {
  readonly kind = 'unauthorized' as const;
}

/** Se pidió demasiadas veces seguidas: hay que esperar `retryAfterSeconds` antes de volver a pedirlo. */
export class TooManyRequestsError extends DomainError {
  readonly kind = 'rate_limited' as const;

  constructor(
    message: string,
    code: string,
    readonly retryAfterSeconds: number | null = null
  ) {
    super(message, code);
  }
}
