// La traducción de los errores del dominio a HTTP: status por familia, mismo mensaje y código, y el Retry-After
// de los pedidos demasiado seguidos.
import { toHttpError } from './domain-error.mapper';
import { InvalidInputError, NotFoundError, TooManyRequestsError } from '../../domain/errors/domain-error';

class Missing extends NotFoundError {}
class Bad extends InvalidInputError {}

describe('toHttpError', () => {
  it('status por familia, con el mensaje y el código del dominio', () => {
    expect(toHttpError(new Missing('No está', 'NOT_FOUND'))).toMatchObject({ statusCode: 404, message: 'No está', code: 'NOT_FOUND', isOperational: false });
    expect(toHttpError(new Bad('Mal', 'BAD_REQUEST'))).toMatchObject({ statusCode: 400, retryAfter: null });
  });

  it('demasiados pedidos: 429 con los segundos a esperar (sale como Retry-After)', () => {
    expect(toHttpError(new TooManyRequestsError('Esperá', 'RATE_LIMIT', 42))).toMatchObject({ statusCode: 429, code: 'RATE_LIMIT', retryAfter: 42 });
  });
});
