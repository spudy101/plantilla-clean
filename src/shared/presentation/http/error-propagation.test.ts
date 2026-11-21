// shouldPropagate: qué errores re-lanza un catch tal cual en vez de envolverlos en un 500 genérico.
import AppError from './app-error.util';
import { shouldPropagate } from './error-propagation';

describe('shouldPropagate', () => {
  it('cualquier AppError, también los 4xx de negocio (antes isOperationalError los dejaba pasar a 500)', () => {
    expect(shouldPropagate(AppError.notFound('x'))).toBe(true);
    expect(shouldPropagate(AppError.badRequest('x'))).toBe(true);
    expect(shouldPropagate(AppError.internal('x'))).toBe(true);
  });

  it('los errores temporales de la base: base caída y conflicto de transacción', () => {
    expect(shouldPropagate({ name: 'PrismaClientKnownRequestError', code: 'P1001' })).toBe(true);
    expect(shouldPropagate({ name: 'PrismaClientKnownRequestError', code: 'P2034' })).toBe(true);
  });

  it('un error cualquiera no: ese sí se envuelve en un 500', () => {
    expect(shouldPropagate(new Error('bug'))).toBe(false);
    expect(shouldPropagate({ name: 'PrismaClientKnownRequestError', code: 'P2010' })).toBe(false);
  });
});
