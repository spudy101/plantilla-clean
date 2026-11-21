// tests/unit/guards/swagger-spec.test.ts
//
// Los specs OpenAPI (admin y client) se arman bien y no tienen $ref colgados: todo schema referenciado
// existe en components.schemas. Cubre lo que se genera desde Zod (requests/ y responses/) y lo escrito a mano.
import express from 'express';
import request from 'supertest';
import swaggerAdminDocs from '../../../src/config/swagger.admin';
import swaggerClientDocs from '../../../src/config/swagger.client';

type Spec = { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };

async function specOf(mount: (router: express.Router) => void): Promise<Spec> {
  const app = express();
  const router = express.Router();
  mount(router);
  app.use(router);
  const res = await request(app).get('/docs.json');
  return (typeof res.body === 'object' && Object.keys(res.body).length ? res.body : JSON.parse(res.text)) as Spec;
}

function danglingRefs(spec: Spec): string[] {
  const refs = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
          refs.add(value);
        } else {
          walk(value);
        }
      }
    }
  };
  walk(spec);
  return [...refs].filter(ref => {
    const name = ref.replace('#/components/schemas/', '');
    return ref.startsWith('#/components/schemas/') && !(name in spec.components.schemas);
  });
}

describe.each([
  ['admin', swaggerAdminDocs],
  ['client', swaggerClientDocs]
])('Swagger %s', (_name, mount) => {
  let spec: Spec;
  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    spec = await specOf(mount);
  });

  it('se arma con paths y schemas', () => {
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(Object.keys(spec.components.schemas).length).toBeGreaterThan(0);
  });

  it('no tiene $ref a schemas inexistentes', () => {
    expect(danglingRefs(spec)).toEqual([]);
  });
});
