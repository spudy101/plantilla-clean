// shared/utils/interop.util.ts
//
// `require()` diferido con la misma semántica que `import x from 'm'`.
//
// Algunos módulos se cargan dentro de una función y no arriba (para cortar un ciclo de imports o no
// cargar shared/models al importar un puerto). Un `require('m').default` a secas no alcanza: si `m`
// está reemplazado por un `jest.mock('m', () => ({ … }))` el objeto del mock no tiene `.default`.
// `import x from 'm'` lo resuelve con el helper de esModuleInterop; esto hace lo mismo:
//
//   const repo = interopDefault(require('./x.repository') as typeof import('./x.repository'));

/** El `default` de un módulo ES, o el módulo entero si no lo es (CommonJS o un mock de Jest). */
export function interopDefault<M extends { default: unknown }>(mod: M): M['default'] {
  return (mod as { __esModule?: boolean }).__esModule ? mod.default : (mod as unknown as M['default']);
}
