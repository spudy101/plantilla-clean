// tests/unit/guards/clean-architecture.test.ts
//
// La regla de dependencias de Clean Architecture, verificada en cada `npm test` (análisis estático: lee
// los imports, no carga nada). Ver docs/ARCHITECTURE.md § Clean Architecture.
//
//   domain  ◄──  application  ◄──  infrastructure
//                     ▲
//                     └──────────  presentation
//
// - domain: no importa nada fuera de sí mismo (ni paquetes npm, ni Prisma, ni Express).
// - application: solo domain y puertos. Tampoco `import type` de Prisma: el caso de uso no habla el idioma
//   de la base.
// - infrastructure: implementa los puertos; no conoce la presentación.
// - presentation: llama a los casos de uso; no conoce la infraestructura.
// - Un módulo en Clean no importa otros módulos: lo que necesita le llega por puertos desde src/main/.
//
// Todos los módulos están en Clean (tienen carpeta domain/): cada uno tiene solo sus cuatro capas y su composición,
// sin index.ts ni las carpetas de la arquitectura en capas (services/, repositories/, …).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const MODULES = path.join(SRC, 'modules');
const SHARED = path.join(SRC, 'shared');

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : walk(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** Todo import del archivo (incluye `import type`, require e import()): relativo → ruta absoluta; paquete → su nombre. */
function importsOf(file: string): Array<{ spec: string; target: string | null }> {
  // Sin comentarios: un ejemplo de uso en un comentario no es una dependencia
  const src = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const specs = [...src.matchAll(/(?:from\s+|^import\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/gm)].map(m => m[1]!);
  return specs.map(spec => ({ spec, target: spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null }));
}

const within = (target: string, dir: string) => target === dir || target.startsWith(dir + path.sep);

const cleanModules = fs
  .readdirSync(MODULES, { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(MODULES, e.name, 'domain')))
  .map(e => e.name);

type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation';

/** Carpetas a las que puede apuntar un import desde `layer` (además de los paquetes, si se permiten). */
function allowedFor(layer: Layer, moduleDir: string | null): string[] {
  const own = (l: string) => (moduleDir ? [path.join(moduleDir, l)] : []);
  const shared = (l: string) => path.join(SHARED, l);
  const kernel = shared('kernel');
  const byLayer: Record<Layer, string[]> = {
    domain: [...own('domain'), shared('domain'), kernel],
    application: [...own('domain'), ...own('application'), shared('domain'), shared('application'), kernel],
    infrastructure: [
      ...own('domain'),
      ...own('application'),
      ...own('infrastructure'),
      shared('domain'),
      shared('application'),
      shared('infrastructure'),
      kernel
    ],
    presentation: [
      ...own('application'),
      ...own('presentation'),
      shared('domain'),
      shared('application'),
      shared('presentation'),
      kernel
    ]
  };
  return byLayer[layer];
}

/** Paquetes npm permitidos por capa. El centro (domain, application) no depende de ninguno. */
const packagesAllowed = (layer: Layer) => layer === 'infrastructure' || layer === 'presentation';

function violations(files: string[], layer: Layer, moduleDir: string | null): string[] {
  const allowed = allowedFor(layer, moduleDir);
  return files.flatMap(file =>
    importsOf(file)
      .filter(({ target }) => (target ? !allowed.some(dir => within(target, dir)) : !packagesAllowed(layer)))
      .map(({ spec }) => `${rel(file)} → ${spec}`)
  );
}

describe('Clean Architecture — regla de dependencias', () => {
  it('hay al menos un módulo en Clean (si no, estas reglas no prueban nada)', () => {
    expect(cleanModules.length).toBeGreaterThan(0);
  });

  it('todos los módulos están en Clean (no queda ninguno en capas)', () => {
    const modules = fs.readdirSync(MODULES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    expect(modules.filter(name => !cleanModules.includes(name))).toEqual([]);
  });

  describe('shared/', () => {
    it.each(['domain', 'application'] as const)('shared/%s solo depende de capas interiores, sin paquetes npm', layer => {
      expect(violations(walk(path.join(SHARED, layer)), layer, null)).toEqual([]);
    });

    it('shared/kernel no depende de nada del proyecto ni de paquetes npm', () => {
      const offenders = walk(path.join(SHARED, 'kernel')).flatMap(file =>
        importsOf(file)
          .filter(({ target }) => !target || !within(target, path.join(SHARED, 'kernel')))
          .map(({ spec }) => `${rel(file)} → ${spec}`)
      );
      expect(offenders).toEqual([]);
    });

    // DEUDA CONOCIDA (fase 2 de la migración): estas utilidades de infraestructura lanzan AppError, que es
    // un error HTTP. Lo correcto es que lancen errores técnicos de shared/application (p. ej. "dependencia no
    // disponible") y que la presentación los traduzca, como ya pasa con los errores del dominio. Las usan los
    // módulos sin migrar, así que se corrigen junto con ellos. Esta lista solo puede ACHICARSE: si un archivo
    // deja de violar la regla, el segundo test exige sacarlo de acá.
    const INFRASTRUCTURE_TO_PRESENTATION_DEBT = [
      'src/shared/infrastructure/providers/circuit-breaker.util.ts → ../../presentation/http/app-error.util',
      'src/shared/infrastructure/providers/circuit-breaker.util.ts → ../../presentation/http/retryable',
      'src/shared/infrastructure/providers/provider-errors.ts → ../../presentation/http/app-error.util',
      'src/shared/infrastructure/security/hcaptcha.util.ts → ../../presentation/http/app-error.util',
      'src/shared/infrastructure/security/jwt.util.ts → ../../presentation/http/app-error.util',
      'src/shared/infrastructure/storage/s3.util.ts → ../../presentation/http/app-error.util',
      'src/shared/infrastructure/storage/s3.util.ts → ../../presentation/http/error-propagation'
    ];
    const infrastructureToPresentation = () =>
      walk(path.join(SHARED, 'infrastructure')).flatMap(file =>
        importsOf(file)
          .filter(({ target }) => target && within(target, path.join(SHARED, 'presentation')))
          .map(({ spec }) => `${rel(file)} → ${spec}`)
      );

    it('shared/infrastructure no conoce la presentación (salvo la deuda conocida)', () => {
      expect(infrastructureToPresentation().filter(v => !INFRASTRUCTURE_TO_PRESENTATION_DEBT.includes(v))).toEqual([]);
    });

    it('la deuda conocida solo se achica: lo que ya se corrigió sale de la lista', () => {
      const current = infrastructureToPresentation();
      expect(INFRASTRUCTURE_TO_PRESENTATION_DEBT.filter(v => !current.includes(v))).toEqual([]);
    });
  });

  describe.each(cleanModules)('modules/%s', name => {
    const moduleDir = path.join(MODULES, name);

    it.each(['domain', 'application', 'infrastructure', 'presentation'] as const)(
      '%s respeta la regla de dependencias',
      layer => {
        expect(violations(walk(path.join(moduleDir, layer)), layer, moduleDir)).toEqual([]);
      }
    );

    it('no importa otros módulos (lo que necesita le llega por puertos desde src/main/)', () => {
      const offenders = walk(moduleDir).flatMap(file =>
        importsOf(file)
          .filter(({ target }) => target && within(target, MODULES) && !within(target, moduleDir))
          .map(({ spec }) => `${rel(file)} → ${spec}`)
      );
      expect(offenders).toEqual([]);
    });

    it('solo tiene las cuatro capas y su composición (<módulo>.module.ts)', () => {
      const entries = fs.readdirSync(moduleDir).sort();
      expect(entries.filter(e => !['domain', 'application', 'infrastructure', 'presentation', `${name}.module.ts`].includes(e))).toEqual([]);
    });

    it('la aplicación no crea sus dependencias (`new`): las recibe por constructor', () => {
      // Un `new XRepository()` dentro de un caso de uso lo ataría a esa implementación
      const offenders = walk(path.join(moduleDir, 'application'))
        .filter(f => /\bnew\s+\w*(?:Repository|Adapter|Client|Service|Gateway)\s*\(/.test(fs.readFileSync(f, 'utf8')))
        .map(rel);
      expect(offenders).toEqual([]);
    });

    it('los puertos son interfaces (archivos *.port.ts en application/ports, sin implementación)', () => {
      const ports = walk(path.join(moduleDir, 'application', 'ports'));
      const offenders = ports
        .filter(f => !f.endsWith('.port.ts') || /^\s*(?:export\s+)?(?:default\s+)?class\s/m.test(fs.readFileSync(f, 'utf8')))
        .map(rel);
      expect(offenders).toEqual([]);
    });
  });

  it('fuera de src/main/, nadie importa la composición ni las capas internas de un módulo en Clean', () => {
    const outside = walk(SRC).filter(f => !within(f, path.join(SRC, 'main')));
    const offenders = outside.flatMap(file =>
      importsOf(file)
        .filter(({ target }) => {
          if (!target) {
            return false;
          }
          const owner = cleanModules.find(m => within(target, path.join(MODULES, m)));
          return Boolean(owner) && !within(file, path.join(MODULES, owner as string));
        })
        .map(({ spec }) => `${rel(file)} → ${spec}`)
    );
    expect(offenders).toEqual([]);
  });
});
