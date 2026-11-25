// La traducción a HTTP de los errores que ya dicen qué responder: los del dominio (status por familia, mismo mensaje y
// código, el Retry-After de los pedidos demasiado seguidos) y los técnicos de la aplicación (503, reintentable o no).
import { toHttpError } from './domain-error.mapper';
import { InternalError, InvalidInputError, NotFoundError, TooManyRequestsError } from '../../domain/errors/domain-error';
import { ServiceUnavailableError } from '../../application/errors';
import { CircuitOpenError } from '../../infrastructure/providers/circuit-breaker.util';

class Missing extends NotFoundError {}
class Bad extends InvalidInputError {}

describe('toHttpError', () => {
  it('status por familia, con el mensaje y el código del dominio', () => {
    expect(toHttpError(new Missing('No está', 'NOT_FOUND'))).toMatchObject({ statusCode: 404, message: 'No está', code: 'NOT_FOUND', isOperational: false });
    expect(toHttpError(new Bad('Mal', 'BAD_REQUEST'))).toMatchObject({ statusCode: 400, retryAfter: null, retryable: false });
  });

  it('un error interno es 500 y se loguea como error (isOperational)', () => {
    expect(toHttpError(new InternalError('Roto', 'INTERNAL_ERROR'))).toMatchObject({ statusCode: 500, isOperational: true, retryable: false });
  });

  it('demasiados pedidos: 429 con los segundos a esperar (sale como Retry-After)', () => {
    expect(toHttpError(new TooManyRequestsError('Esperá', 'RATE_LIMIT', 42))).toMatchObject({ statusCode: 429, code: 'RATE_LIMIT', retryAfter: 42 });
  });

  it('una dependencia no disponible: 503 temporal, sin Retry-After si no se sabe cuánto esperar', () => {
    expect(toHttpError(new ServiceUnavailableError('Caído'))).toMatchObject({
      statusCode: 503,
      message: 'Caído',
      code: 'SERVICE_UNAVAILABLE',
      retryable: true,
      retryAfter: null,
      isOperational: false
    });
  });

  it('falta configuración: 503 pero NO reintentable (hasta que alguien la ponga)', () => {
    expect(toHttpError(new ServiceUnavailableError('Sin clave', { retryable: false }))).toMatchObject({ statusCode: 503, retryable: false });
  });

  it('circuito abierto: 503 CIRCUIT_OPEN con Retry-After, y se loguea como incidente', () => {
    expect(toHttpError(new CircuitOpenError('aws_s3', 2500))).toMatchObject({
      statusCode: 503,
      code: 'CIRCUIT_OPEN',
      retryable: true,
      retryAfter: 3,
      isOperational: true
    });
  });
});
