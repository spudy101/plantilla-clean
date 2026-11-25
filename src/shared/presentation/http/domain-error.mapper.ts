// Traduce un error del dominio (shared/domain/errors) a su respuesta HTTP. Es el único lugar que sabe que
// "no existe" es un 404 o que "rompe una regla" es un 422: el dominio y los casos de uso no conocen HTTP.
import AppError from './app-error.util';
import { TooManyRequestsError, type DomainError, type DomainErrorKind } from '../../domain/errors/domain-error';

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  not_found: 404,
  conflict: 409,
  rule_violation: 422,
  invalid_input: 400,
  forbidden: 403,
  unauthorized: 401,
  rate_limited: 429,
  internal: 500
};

/** El AppError equivalente (mismo mensaje, código y detalle) para el manejador de errores HTTP. */
export function toHttpError(error: DomainError): AppError {
  // isOperational=false: es un error de negocio esperado (se loguea como info/warn, no como error). Un error
  // interno sí es grave: se loguea como error, igual que un AppError.internal.
  const httpError = new AppError(error.message, STATUS_BY_KIND[error.kind], error.code, error.details, error.kind === 'internal');
  httpError.stack = error.stack;
  if (error instanceof TooManyRequestsError) {
    // Sale en el header Retry-After
    httpError.retryAfter = error.retryAfterSeconds;
  }
  return httpError;
}
