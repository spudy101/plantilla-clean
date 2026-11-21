// tests/unit/shared/app-error.util.test.ts
//
// AppError: clase de error operacional que extiende Error nativo y expone factory methods
// por código HTTP. Es lógica pura (sin dependencias externas): verificamos statusCode, code,
// details, isOperational y retryAfter de cada factory, más el contrato del constructor.

import AppError from './app-error.util';

describe('AppError', () => {
  describe('constructor', () => {
    it('hereda de Error y conserva message y name', () => {
      const err = new AppError('algo falló');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
      expect(err.message).toBe('algo falló');
      expect(err.name).toBe('AppError');
    });

    it('captura stack trace', () => {
      const err = new AppError('boom');
      expect(typeof err.stack).toBe('string');
      expect(err.stack?.length).toBeGreaterThan(0);
    });

    it('aplica los defaults: 500, code null, details null, isOperational true, retryAfter null', () => {
      const err = new AppError('sin opciones');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBeNull();
      expect(err.details).toBeNull();
      expect(err.isOperational).toBe(true);
      expect(err.retryAfter).toBeNull();
    });

    it('respeta los valores explícitos pasados al constructor', () => {
      const details = [{ field: 'x' }];
      const err = new AppError('custom', 418, 'TEAPOT', details, false);
      expect(err.statusCode).toBe(418);
      expect(err.code).toBe('TEAPOT');
      expect(err.details).toBe(details);
      expect(err.isOperational).toBe(false);
    });
  });

  describe('badRequest', () => {
    it('produce un error 400 BAD_REQUEST no operacional con details', () => {
      const details = { campo: 'edad' };
      const err = AppError.badRequest('parámetro inválido', details);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.message).toBe('parámetro inválido');
      expect(err.details).toBe(details);
      expect(err.isOperational).toBe(false);
    });
  });

  describe('unauthorized', () => {
    it('usa el mensaje por defecto "No autorizado" y código 401', () => {
      const err = AppError.unauthorized();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toBe('No autorizado');
      expect(err.isOperational).toBe(false);
    });

    it('permite sobreescribir el mensaje', () => {
      const err = AppError.unauthorized('token vencido');
      expect(err.message).toBe('token vencido');
    });
  });

  describe('forbidden', () => {
    it('genera 403 FORBIDDEN con mensaje por defecto "Acceso denegado"', () => {
      const err = AppError.forbidden();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
      expect(err.message).toBe('Acceso denegado');
    });
  });

  describe('notFound', () => {
    it('genera 404 NOT_FOUND con mensaje por defecto', () => {
      const err = AppError.notFound();
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('Recurso no encontrado');
    });
  });

  describe('conflict', () => {
    it('genera 409 CONFLICT no operacional', () => {
      const err = AppError.conflict('ya existe');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toBe('ya existe');
      expect(err.isOperational).toBe(false);
    });
  });

  describe('unprocessableEntity', () => {
    it('genera 422 UNPROCESSABLE_ENTITY propagando el array de details', () => {
      const details = [{ field: 'email', message: 'inválido' }];
      const err = AppError.unprocessableEntity('datos incorrectos', details);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('UNPROCESSABLE_ENTITY');
      expect(err.details).toBe(details);
    });
  });

  describe('tooManyRequests', () => {
    it('genera 429 RATE_LIMIT y setea retryAfter', () => {
      const err = AppError.tooManyRequests('espere', null, 120);
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('RATE_LIMIT');
      expect(err.retryAfter).toBe(120);
      expect(err.isOperational).toBe(false);
    });

    it('usa mensaje por defecto y retryAfter null cuando no se pasan', () => {
      const err = AppError.tooManyRequests();
      expect(err.message).toBe('Demasiadas peticiones');
      expect(err.retryAfter).toBeNull();
    });
  });

  describe('internal', () => {
    it('genera 500 INTERNAL_ERROR marcado como operacional (grave)', () => {
      const err = AppError.internal();
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.message).toBe('Error interno del servidor');
      expect(err.isOperational).toBe(true);
    });
  });

  describe('serviceUnavailable', () => {
    it('genera 503 SERVICE_UNAVAILABLE no operacional', () => {
      const err = AppError.serviceUnavailable();
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('SERVICE_UNAVAILABLE');
      expect(err.message).toBe('Servicio no disponible temporalmente');
      expect(err.isOperational).toBe(false);
    });
  });
});
