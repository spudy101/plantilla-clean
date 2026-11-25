// ApiResponse: capa central de respuestas HTTP. Cada helper arma el sobre estándar
// { success, statusCode, message, data, metadata, timestamp } y lo escribe en `res`.
// Mockeamos las constantes HTTP_STATUS y el middleware de enmascaramiento PII (aquí lo
// dejamos como identidad para poder verificar la estructura del sobre sin ruido de redacción).

jest.mock('../../infrastructure/config', () => ({
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
  }
}));

jest.mock('./pii-masking.middleware', () => ({
  // Identidad: devolvemos el payload tal cual para inspeccionar la estructura del sobre.
  apply: jest.fn((res, payload) => payload)
}));

import { mocked, Loose, fixture } from 'tests/helpers/mock';
import ApiResponse from './app-response.util';
import PiiMaskingMiddlewareModule from './pii-masking.middleware';
const PiiMaskingMiddleware = mocked(PiiMaskingMiddlewareModule);

// Construye un doble de `res` de Express con status/json/send encadenables.
function mockRes() {
  const res: Loose = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

describe('ApiResponse', () => {
  describe('success', () => {
    it('responde 200 con el sobre de éxito completo', () => {
      const res: Loose = mockRes();
      const data = { id: 7 };
      ApiResponse.success(fixture(res), 'ok', data);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.statusCode).toBe(200);
      expect(body.message).toBe('ok');
      expect(body.data).toEqual(data);
      expect(body.metadata).toBeNull();
      expect(typeof body.timestamp).toBe('string');
    });

    it('permite un statusCode y metadata personalizados', () => {
      const res: Loose = mockRes();
      const meta = { page: 1 };
      ApiResponse.success(fixture(res), 'listo', { x: 1 }, 202, meta);
      expect(res.status).toHaveBeenCalledWith(202);
      const body = res.json.mock.calls[0][0];
      expect(body.statusCode).toBe(202);
      expect(body.metadata).toEqual(meta);
    });

    it('aplana la respuesta cuando data llega como { data, metadata }', () => {
      const res: Loose = mockRes();
      const listDto = { data: [1, 2, 3], metadata: { total: 3 } };
      ApiResponse.success(fixture(res), 'lista', listDto);
      const body = res.json.mock.calls[0][0];
      // El sobre debe llevar el array al nivel raíz y la metadata del DTO, no el objeto anidado.
      expect(body.data).toEqual([1, 2, 3]);
      expect(body.metadata).toEqual({ total: 3 });
    });

    it('pasa data y metadata por el enmascarado PII', () => {
      const res = mockRes();
      ApiResponse.success(fixture(res), 'ok', { secreto: 1 });
      expect(PiiMaskingMiddleware.apply).toHaveBeenCalledWith(res, { secreto: 1 });
    });
  });

  describe('created', () => {
    it('responde 201', () => {
      const res: Loose = mockRes();
      ApiResponse.created(fixture(res), 'creado', { id: 1 });
      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.statusCode).toBe(201);
      expect(body.success).toBe(true);
    });
  });

  describe('accepted', () => {
    it('responde 202', () => {
      const res: Loose = mockRes();
      ApiResponse.accepted(fixture(res), 'aceptado');
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json.mock.calls[0][0].statusCode).toBe(202);
    });
  });

  describe('noContent', () => {
    it('responde 204 sin cuerpo (send, no json)', () => {
      const res: Loose = mockRes();
      ApiResponse.noContent(fixture(res));
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('responde 500 por defecto con el sobre de error básico', () => {
      const res: Loose = mockRes();
      ApiResponse.error(fixture(res), 'ups');
      expect(res.status).toHaveBeenCalledWith(500);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(500);
      expect(body.message).toBe('ups');
      // Sin errorCode ni errors si no se proveen.
      expect(body).not.toHaveProperty('errorCode');
      expect(body).not.toHaveProperty('errors');
    });

    it('incluye errorCode y errors cuando se proveen', () => {
      const res: Loose = mockRes();
      const errors = [{ field: 'a', message: 'req' }];
      ApiResponse.error(fixture(res), 'malo', 400, 'BAD_REQUEST', errors);
      const body = res.json.mock.calls[0][0];
      expect(body.statusCode).toBe(400);
      expect(body.errorCode).toBe('BAD_REQUEST');
      expect(body.errors).toEqual(errors);
    });
  });

  describe('helpers de error', () => {
    it('badRequest → 400 BAD_REQUEST con errors', () => {
      const res: Loose = mockRes();
      const errors = [{ field: 'x' }];
      ApiResponse.badRequest(fixture(res), 'faltan datos', errors);
      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.json.mock.calls[0][0];
      expect(body.errorCode).toBe('BAD_REQUEST');
      expect(body.errors).toEqual(errors);
    });

    it('unauthorized → 401 UNAUTHORIZED con mensaje por defecto', () => {
      const res: Loose = mockRes();
      ApiResponse.unauthorized(fixture(res));
      expect(res.status).toHaveBeenCalledWith(401);
      const body = res.json.mock.calls[0][0];
      expect(body.message).toBe('No autorizado');
      expect(body.errorCode).toBe('UNAUTHORIZED');
    });

    it('forbidden → 403 FORBIDDEN', () => {
      const res: Loose = mockRes();
      ApiResponse.forbidden(fixture(res));
      expect(res.status).toHaveBeenCalledWith(403);
      const body = res.json.mock.calls[0][0];
      expect(body.message).toBe('Acceso denegado');
      expect(body.errorCode).toBe('FORBIDDEN');
    });

    it('notFound → 404 NOT_FOUND', () => {
      const res: Loose = mockRes();
      ApiResponse.notFound(fixture(res));
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].errorCode).toBe('NOT_FOUND');
    });

    it('conflict → 409 CONFLICT', () => {
      const res: Loose = mockRes();
      ApiResponse.conflict(fixture(res), 'duplicado');
      expect(res.status).toHaveBeenCalledWith(409);
      const body = res.json.mock.calls[0][0];
      expect(body.message).toBe('duplicado');
      expect(body.errorCode).toBe('CONFLICT');
    });

    it('tooManyRequests → 429 RATE_LIMIT', () => {
      const res: Loose = mockRes();
      ApiResponse.tooManyRequests(fixture(res));
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json.mock.calls[0][0].errorCode).toBe('RATE_LIMIT');
    });

    it('validationError → 422 VALIDATION_ERROR con array de errores', () => {
      const res: Loose = mockRes();
      const errors = [{ field: 'email', message: 'inválido' }];
      ApiResponse.validationError(fixture(res), errors);
      expect(res.status).toHaveBeenCalledWith(422);
      const body = res.json.mock.calls[0][0];
      expect(body.message).toBe('Error de validación');
      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(body.errors).toEqual(errors);
    });
  });
});
