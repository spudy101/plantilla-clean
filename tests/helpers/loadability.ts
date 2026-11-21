// tests/helpers/loadability.ts
//
// Helper compartido para los load-tests de cargabilidad (Tier 1). Centraliza el
// recorrido del árbol de archivos y las exclusiones para que cada test de área
// (src/shared, src/modules)
// solo declare QUÉ subárbol cubre, sin duplicar la mecánica.
//
// Cada archivo de área llama a `describeLoadability(baseDir)` y obtiene un bloque
// que verifica que TODOS los módulos de ese subárbol se puedan `require()` sin lanzar.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

// Archivos de arranque / con efectos secundarios al importar (levantan servidor,
// abren puertos, etc.). No forman parte de la superficie que estos tests cubren.
const EXCLUDES = [
  /[\\/]node_modules[\\/]/,
  /[\\/]generated[\\/]/, // cliente de Prisma generado
  /[\\/]src[\\/](app|server)\.ts$/, // arman la app Express / levantan el servidor
  /\.test\.ts$/
];

/**
 * Recorre recursivamente `dir` y devuelve las rutas absolutas de los .ts no excluidos
 * (los .d.ts solo declaran tipos: no hay nada que cargar).
 */
function collectModuleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectModuleFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      if (!EXCLUDES.some(re => re.test(full))) {out.push(full);}
    }
  }
  return out;
}

/**
 * Declara el bloque `describe` de cargabilidad para un subárbol relativo a la raíz.
 * @param baseDir Ruta relativa a la raíz del repo (p. ej. 'src/modules').
 */
function describeLoadability(baseDir: string): void {
  describe(`cargabilidad · ${baseDir}/`, () => {
    const files = collectModuleFiles(path.join(ROOT, baseDir));

    it(`encuentra módulos en ${baseDir}/`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files.map(f => [path.relative(ROOT, f).replace(/\\/g, '/'), f] as const))('carga %s', (_rel, full) => {
      expect(() => require(full)).not.toThrow();
    });
  });
}

export default { ROOT, EXCLUDES, collectModuleFiles, describeLoadability };
