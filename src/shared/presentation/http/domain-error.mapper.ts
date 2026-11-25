// Traduce un error que ya dice qué responder (de negocio, de shared/domain/errors, o técnico, de
// shared/application/errors) a su respuesta HTTP. Es el único lugar que sabe que "no existe" es un 404, que "rompe una
// regla" es un 422 o que "un proveedor no está disponible" es un 503: el dominio, los casos de uso y la
// infraestructura no conocen HTTP.
import AppError from './app-error.util';
import { TooManyRequestsError, type DomainError, type DomainErrorKind } from '../../domain/errors/domain-error';
import { ServiceUnavailableError, type ExpectedError } from '../../application/errors';

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

const SERVICE_UNAVAILABLE_STATUS = 503;

/** El AppError equivalente (mismo mensaje, código y detalle) para el manejador de errores HTTP. */
export function toHttpError(error: ExpectedError): AppError {
  const httpError = error instanceof ServiceUnavailableError ? fromServiceUnavailable(error) : fromDomainError(error);
  httpError.stack = error.stack;
  return httpError;
}

function fromDomainError(error: DomainError): AppError {
  // isOperational=false: es un error de negocio esperado (se loguea como info/warn, no como error). Un error
  // interno sí es grave: se loguea como error, igual que un AppError.internal.
  const httpError = new AppError(error.message, STATUS_BY_KIND[error.kind], error.code, error.details, error.kind === 'internal');
  if (error instanceof TooManyRequestsError) {
    // Sale en el header Retry-After
    httpError.retryAfter = error.retryAfterSeconds;
  }
  return httpError;
}

function fromServiceUnavailable(error: ServiceUnavailableError): AppError {
  // Un incidente (el circuito de un proveedor abierto) se loguea como error; una dependencia caída esperable, como warn
  const httpError = new AppError(error.message, SERVICE_UNAVAILABLE_STATUS, error.code, error.details, error.incident);
  httpError.retryable = error.retryable;
  httpError.retryAfter = error.retryAfterSeconds;
  return httpError;
}
