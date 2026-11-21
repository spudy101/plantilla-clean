// tests/helpers/mock.ts
//
// Tipado de los módulos mockeados con jest.mock(). `jest.mocked()` exige que cada fixture tenga la
// forma completa del valor real (una instancia de modelo, un Request de Express…), y los tests usan
// fixtures parciales a propósito: solo los campos que el código bajo prueba lee. `mocked()` expone
// cada función del módulo como `jest.Mock` (acepta cualquier fixture) sin perder la forma del módulo:
// un nombre mal escrito sigue siendo error de tipos. El módulo bajo prueba se importa sin envolver,
// así que sus llamadas sí se revisan contra el contrato real.

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures parciales: ver el comentario de arriba */
type AnyFunction = (...args: any[]) => any;
type AnyConstructor = abstract new (...args: any[]) => any;

export type LooseMocked<T> = T extends AnyFunction | AnyConstructor
  ? jest.Mock & { [K in keyof T]: LooseMocked<T[K]> }
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]: LooseMocked<T[K]> }
      : T;

/**
 * Valor de test sin tipo fijo: parámetros de implementaciones de mocks (`jest.fn(r => …)`), dobles
 * armados por partes (`const res: Loose = {}; res.status = jest.fn()…`) y variables que se cargan en
 * un `beforeEach`. Es `any` con nombre: solo para tests.
 */
export type Loose = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Vista tipada (laxa) de un módulo reemplazado por jest.mock(). No cambia el valor. */
export function mocked<T>(mod: T): LooseMocked<T> {
  return mod as LooseMocked<T>;
}

/**
 * Fixture parcial pasado donde el código bajo prueba espera el tipo completo (un `Request`, una
 * instancia de modelo, un contexto de auditoría…): el test arma solo los campos que ese código lee.
 */
export function fixture<T = never>(value: unknown): T {
  return value as T;
}
