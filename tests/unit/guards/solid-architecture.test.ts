// tests/unit/guards/solid-architecture.test.ts
//
// Guardas del acceso a datos (análisis estático, sin cargar módulos): el ORM es Prisma y solo lo tocan los
// repositorios y shared/infrastructure/database. Las capas de cada módulo las verifica
// tests/unit/guards/clean-architecture.test.ts. Si una falla, la corrección casi siempre es mover la consulta, el
// enum o el include al repositorio — no ampliar el allowlist.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // generated/: cliente de Prisma generado (no es código del proyecto)
      return entry.name === 'node_modules' || entry.name === 'generated' ? [] : walk(full);
    }
    // los .d.ts solo declaran tipos
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file: string) => fs.readFileSync(file, 'utf8');
const sourceFiles = walk(path.join(ROOT, 'src')).filter(f => !f.endsWith('.test.ts'));
const isRepository = (f: string) => f.endsWith('.repository.ts') || f.endsWith('.repositories.ts');

// `import … from '…'` y los require('…') diferidos. `import type` se excluye: solo trae tipos (las formas de las
// filas), no acopla en runtime.
const valueImport = (target: string) =>
  new RegExp(`(?:require\\(\\s*|^import (?!type)[^\\n]*from\\s+)['"][^'"]*(?:${target})['"]`, 'm');
const SEQUELIZE_REQUIRE = valueImport('\\bsequelize');
// El cliente de Prisma: la instancia (shared/infrastructure/database/prisma), el cliente generado y los paquetes.
const PRISMA_CLIENT_REQUIRE = valueImport(
  'database/prisma|generated/prisma/(?:client|internal|models)|@prisma/client|@prisma/adapter-pg'
);
const PRISMA_ENUMS_REQUIRE = valueImport('generated/prisma/enums');

describe('Arquitectura — fronteras', () => {
  it('shared/ no importa nada de modules/ (lo que necesita se le registra desde src/main/)', () => {
    const anyImport = /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*\/modules\//;
    const offenders = sourceFiles.filter(f => rel(f).startsWith('src/shared/') && anyImport.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('Acceso a datos — guardas', () => {
  const projectFiles = [...sourceFiles, ...walk(path.join(ROOT, 'prisma'))];
  const ormLayer = (f: string) => isRepository(f) || rel(f).startsWith('src/shared/infrastructure/database/');

  it('nadie importa sequelize (el ORM es Prisma)', () => {
    const offenders = projectFiles.filter(f => SEQUELIZE_REQUIRE.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('el cliente de Prisma solo se usa en repositorios y shared/infrastructure/database', () => {
    // `import type` sí vale fuera (tipos de filas en los mappers). El seed (prisma/) no entra: es un CLI de datos
    // que usa el cliente de la app a propósito.
    const offenders = sourceFiles.filter(f => !ormLayer(f) && PRISMA_CLIENT_REQUIRE.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('los enums generados se leen desde shared/infrastructure/database/domain-enums (única puerta, con chequeo de exhaustividad)', () => {
    const offenders = sourceFiles
      .filter(f => !ormLayer(f) && rel(f) !== 'src/shared/infrastructure/database/domain-enums.ts' && PRISMA_ENUMS_REQUIRE.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('todo repositorio extiende PrismaRepository (L)', () => {
    const offenders = sourceFiles
      .filter(f => isRepository(f) && !rel(f).startsWith('src/shared/infrastructure/database/'))
      .filter(f => !/extends\s+PrismaRepository\b/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
