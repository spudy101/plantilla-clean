// tests/unit/guards/idempotent-routes.test.ts
//
// Rutas con idempotent() (docs/idempotency.md), por análisis estático de los *.routes.ts:
//   - no usan además RequestLockMiddleware: la clave ya resuelve las simultáneas (no duplicar mecanismos)
//   - validan ANTES de idempotent(): un body inválido no debe gastar la clave del cliente

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(full);
    }
    return entry.name.endsWith('.routes.ts') ? [full] : [];
  });
}

/** Cada `router.<método>(...)` completo, con el archivo donde está. */
function routeBlocks() {
  return routeFiles(path.join(ROOT, 'src/modules')).flatMap(file => {
    const src = fs.readFileSync(file, 'utf8');
    return [...src.matchAll(/router\.(?:get|post|put|patch|delete)\(([\s\S]*?)\n\);/g)].map(m => ({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      block: m[1]!
    }));
  });
}

const idempotentRoutes = routeBlocks().filter(r => r.block.includes('idempotent()'));

describe('Guardas — rutas idempotentes', () => {
  it('hay rutas idempotentes (la guarda no quedó vacía por un cambio de forma)', () => {
    expect(idempotentRoutes.length).toBeGreaterThanOrEqual(3);
  });

  it('no usan además RequestLockMiddleware', () => {
    const offenders = idempotentRoutes.filter(r => r.block.includes('RequestLockMiddleware')).map(r => r.file);
    expect(offenders).toEqual([]);
  });

  it('validan el body antes de reclamar la clave', () => {
    const offenders = idempotentRoutes
      .filter(r => {
        const validateAt = r.block.indexOf('validate(');
        return validateAt === -1 || validateAt > r.block.indexOf('idempotent()');
      })
      .map(r => r.file);
    expect(offenders).toEqual([]);
  });
});
