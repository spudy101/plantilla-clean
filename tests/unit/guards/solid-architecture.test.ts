// tests/unit/guards/solid-architecture.test.ts
//
// Guardas de arquitectura (análisis estático, sin cargar módulos). Hacen cumplir las reglas de
// docs/solid.md para que no se pierdan con el tiempo. Si una falla, la corrección casi siempre es
// mover la consulta/enum/include al repositorio o a shared/constants — no ampliar el allowlist.

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
const isService = (f: string) => f.endsWith('.service.ts');
const isRepository = (f: string) => f.endsWith('.repository.ts');

// Capa de aplicación: lo que NO debe conocer el ORM.
const APPLICATION_LAYER = /\.(service|helper|validator|controller|middleware|util)\.(js|ts)$/;

// `import … from '…'` y los require('…') diferidos (cortan ciclos de carga).
// `import type` se excluye: solo trae tipos (las formas de las filas), no acopla en runtime.
const valueImport = (target: string) =>
  new RegExp(`(?:require\\(\\s*|^import (?!type)[^\\n]*from\\s+)['"][^'"]*(?:${target})['"]`, 'm');
const SEQUELIZE_REQUIRE = valueImport('\\bsequelize');
// El cliente de Prisma: la instancia (shared/database/prisma), el cliente generado y los paquetes.
const PRISMA_CLIENT_REQUIRE = valueImport(
  'database/prisma|generated/prisma/(?:client|internal|models)|@prisma/client|@prisma/adapter-pg'
);
const PRISMA_ENUMS_REQUIRE = valueImport('generated/prisma/enums');
const REPOSITORY_REQUIRE = /(?:require\(|from\s+)\s*['"][^'"]*\.repository['"]/;
const CONSTRUCTOR_DEPS = /constructor\(deps(?::\s*[^=)]+)?\s*=\s*\{\}\)/;

describe('Arquitectura — fronteras (docs/ARCHITECTURE.md)', () => {
  it('shared/ no importa nada de modules/ (lo que necesita se le registra desde src/app.ts)', () => {
    const anyImport = /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*\/modules\//;
    const offenders = sourceFiles.filter(f => rel(f).startsWith('src/shared/') && anyImport.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('entre módulos solo se usa el index.ts del otro (su API pública), nunca un archivo interno', () => {
    const MODULES = path.join(ROOT, 'src', 'modules');
    const moduleOf = (abs: string) => {
      const r = path.relative(MODULES, abs);
      return r.startsWith('..') ? null : r.split(path.sep)[0];
    };
    const offenders: string[] = [];
    // src/config/swagger.*.ts compone la documentación de todos los módulos (sus docs/*.paths.ts): es la
    // única excepción, hasta que la documentación salga de los esquemas de validación.
    for (const file of sourceFiles.filter(f => !rel(f).startsWith('src/config/'))) {
      const own = moduleOf(file);
      for (const [, spec] of read(file).matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), spec!);
        const mod = moduleOf(target);
        const isIndex = target === path.join(MODULES, mod ?? '') || target === path.join(MODULES, mod ?? '', 'index');
        if (mod && mod !== own && !isIndex) {
          offenders.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('SOLID — guardas de arquitectura', () => {
  const applicationFiles = sourceFiles.filter(f => APPLICATION_LAYER.test(f));
  const projectFiles = [
    ...sourceFiles,
    ...walk(path.join(ROOT, 'prisma'))
  ];
  const ormLayer = (f: string) =>
    isRepository(f) || rel(f).startsWith('src/shared/database/');

  it('nadie importa sequelize (el ORM es Prisma)', () => {
    const offenders = projectFiles.filter(f => SEQUELIZE_REQUIRE.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('el cliente de Prisma solo se usa en repositorios y shared/database (D: los services dependen del repositorio)', () => {
    // `import type` sí vale fuera (tipos de filas en DTOs y services). El seed (prisma/) no entra: es un
    // CLI de datos que usa el cliente de la app a propósito.
    const offenders = sourceFiles.filter(f => !ormLayer(f) && PRISMA_CLIENT_REQUIRE.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('los enums generados se leen desde shared/constants/domain-enums (única puerta, con chequeo de exhaustividad)', () => {
    const offenders = sourceFiles
      .filter(f => !ormLayer(f) && rel(f) !== 'src/shared/constants/domain-enums.ts' && PRISMA_ENUMS_REQUIRE.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('la capa de aplicación no arma consultas de Prisma (where/include viven en el repositorio)', () => {
    // `$queryRaw`/`$transaction` o un delegate (`prisma.user.`) fuera de los repositorios = el ORM se filtró
    const offenders = applicationFiles
      .filter(f =>
        /\$(?:queryRaw|executeRaw|transaction)\b|\bprisma\.\w+\.(?:find|create|update|delete|upsert|count)/.test(read(f))
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('los services no arman include con modelos (`model: X`) — los include viven en el repositorio', () => {
    const offenders = sourceFiles
      .filter(isService)
      .filter(f => /\bmodel:\s*[A-Z]\w*/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('todo repositorio extiende PrismaRepository (L)', () => {
    const offenders = sourceFiles
      .filter(f => isRepository(f) && !rel(f).startsWith('src/shared/database/'))
      .filter(f => !/extends\s+PrismaRepository\b/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('los services de clase exportan también la clase para inyectar dependencias en tests (D)', () => {
    const offenders = sourceFiles
      .filter(isService)
      .filter(f => {
        // export default Object.assign(new X(), { X });   (export default new X() sin la clase no vale)
        return /export\s+default\s+new\s+\w+\(/.test(read(f));
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('los services con repositorios los reciben por constructor(deps) (D)', () => {
    const offenders = sourceFiles
      .filter(isService)
      .filter(f => {
        const src = read(f);
        return REPOSITORY_REQUIRE.test(src) && !CONSTRUCTOR_DEPS.test(src);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
