// Errores técnicos de la aplicación: algo que no es una regla de negocio rota (eso es shared/domain/errors) pero
// que tampoco es un bug, y que quien llama necesita distinguir para decidir si reintentar.
//
//   ServiceUnavailableError   algo de lo que dependemos (un proveedor externo, un servicio sin configurar) no
//                             está disponible ahora
//
// Como con los errores del dominio, quien los lanza (un caso de uso, un adaptador de infraestructura) no sabe de
// HTTP: shared/presentation/http/domain-error.mapper.ts los traduce a su respuesta (503 + Retry-After).
import { DomainError } from '../domain/errors/domain-error';

export interface ServiceUnavailableOptions {
  /** Código estable para el cliente (por defecto 'SERVICE_UNAVAILABLE'). */
  code?: string;
  details?: Record<string, unknown> | null;
  /** Cuánto esperar antes de reintentar, si se sabe (sale como Retry-After). */
  retryAfterSeconds?: number | null;
  /** ¿Reintentar la misma operación puede funcionar? No, si falta configuración: hasta que alguien la ponga. */
  retryable?: boolean;
  /** Es un incidente de operación (se loguea como error, p. ej. el circuito de un proveedor abierto), no algo esperable. */
  incident?: boolean;
}

/** Algo de lo que dependemos no está disponible ahora. */
export class ServiceUnavailableError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | null;
  readonly retryAfterSeconds: number | null;
  readonly retryable: boolean;
  readonly incident: boolean;

  constructor(message = 'Servicio no disponible temporalmente', options: ServiceUnavailableOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'SERVICE_UNAVAILABLE';
    this.details = options.details ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.retryable = options.retryable ?? true;
    this.incident = options.incident ?? false;
  }
}

/** Un error que ya dice qué responder: de negocio (DomainError) o técnico de la aplicación. */
export type ExpectedError = DomainError | ServiceUnavailableError;

/**
 * ¿El error ya dice qué responder? Un `catch` que lo recibe lo re-lanza tal cual en vez de envolverlo en un error
 * interno genérico (si no, un 404 lanzado dentro del `try` saldría como 500).
 */
export function isExpectedError(error: unknown): error is ExpectedError {
  return error instanceof DomainError || error instanceof ServiceUnavailableError;
}
