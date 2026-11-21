// tests/integration/app-smoke.test.ts
//
// Smoke test end-to-end del pipeline HTTP. Levanta la app Express real (cliente) con
// supertest y verifica que el request atraviesa toda la cadena de middlewares
// (correlation → security → body-parse → audit → routing → error handling) y responde
// con los contratos esperados.
//
// Complementa a los tests de servicio/unidad (que cubren la lógica de negocio con
// repos mockeados): este valida que la app se ENSAMBLA y RESPONDE de punta a punta.
//
// Necesita Postgres: la BD de test es el esquema aislado de tests/test-env.ts (`npm run db:test:prepare`).
// /health verifica la base (shared/database/database-health.ts).

import request from 'supertest';

// La app completa (admin + client); las rutas de negocio cuelgan de /admin y /client.
import app from '../../src/main/app';

describe('App smoke (client) · pipeline HTTP end-to-end', () => {
  it('GET /health responde 200 con el contrato de health check', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: expect.any(String),
      service: expect.any(String),
      checks: expect.objectContaining({
        database: expect.objectContaining({ status: 'healthy' })
      })
    });
  });

  it('GET / responde con la info del servicio', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      service: expect.any(String)
    });
  });

  it('propaga el Correlation ID en el header de respuesta', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-correlation-id']).toBeTruthy();
  });

  it('ignora un X-Correlation-Id entrante como id: siempre genera el suyo', async () => {
    const incoming = 'smoke-test-correlation-id';
    const res = await request(app).get('/health').set('X-Correlation-Id', incoming);
    expect(res.headers['x-correlation-id']).toBeTruthy();
    expect(res.headers['x-correlation-id']).not.toBe(incoming);
  });

  it('ruta desconocida → 404 con el envelope de error estándar', async () => {
    const res = await request(app).get('/client/api/v1/ruta-que-no-existe-jamas');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
  });

  it('JSON malformado → 400 INVALID_JSON_BODY (no INTERNAL_ERROR)', async () => {
    const res = await request(app)
      .post('/client/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ "email": ');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_JSON_BODY'
    });
  });

  describe('listados paginados (catálogo público de géneros)', () => {
    const GENDERS = '/client/api/v1/kyc/maintainers/genders';

    it('responde { data, metadata } con la paginación y el orden aplicados', async () => {
      const res = await request(app).get(GENDERS).query({ limit: '2', sortBy: 'name', order: 'asc' });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.metadata).toMatchObject({
        pagination: { currentPage: 1, pageSize: 2 },
        sort: { field: 'name', order: 'ASC' }
      });
    });

    it('un sortBy fuera de los campos permitidos → 422 con la pista de los válidos', async () => {
      const res = await request(app).get(GENDERS).query({ sortBy: 'passwordHash' });

      expect(res.status).toBe(422);
      expect(res.body.errors).toEqual([expect.objectContaining({ field: 'sortBy', hint: 'Ordená por uno de: createdAt, name' })]);
    });
  });

  it('aplica headers de seguridad (helmet)', async () => {
    const res = await request(app).get('/health');
    // helmet fija, entre otros, X-Content-Type-Options: nosniff
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
