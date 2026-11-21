// shared/database/prisma-extensions.ts
//
// Lo que en Sequelize hacían los hooks de los modelos, como extensión de consulta de Prisma
// (docs/prisma-migration.md, fase 4). Se aplica a TODA operación de modelo del cliente único y de las
// transacciones del Unit of Work:
//
//   - Escritura (create/update/upsert/createMany/updateMany y las anidadas): cifra los campos de
//     ENCRYPTED_FIELDS y completa su hash de búsqueda; poner un campo en null también limpia su hash
//     (el hook de Sequelize dejaba el hash viejo).
//   - Lectura (y lo que devuelven create/update/upsert/delete): descifra esos campos, también dentro de
//     un `include` (el afterFind de Sequelize no siempre corría en los hijos). Un valor que no se puede
//     descifrar (legacy en claro) se deja como está.
//   - `where` sobre un campo cifrado: error. Con IV aleatorio nunca coincide; se filtra por su hash
//     (hashValue(), como hacen hoy los repositorios).
//   - Creación de filas de modelos con `originSessionId`: lo completa (y `originCorrelationId`) desde el
//     contexto de la request si no viene (mixin origin-session de Sequelize). Un valor explícito gana.
//
// Para recorrer anidados usa PRISMA_MODELS (relaciones por modelo), que se genera del schema.
// Las funciones de transformación son puras y se exportan para testearlas sin base.
import { Prisma } from './generated/prisma/client';
import { PRISMA_MODELS } from './generated/prisma-metadata';
import { ENCRYPTED_FIELDS, hashValue, openValue, sealValue } from './pii-fields';
import requestContext from '../observability/request-context.util';

type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const relationsOf = (model: string) => PRISMA_MODELS[model]?.relations ?? {};
const hasOrigin = (model: string) => PRISMA_MODELS[model]?.scalars.includes('originSessionId') ?? false;

/** Operaciones que devuelven filas (se descifran). */
const RETURNS_RECORDS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'create', 'createManyAndReturn', 'update', 'updateManyAndReturn', 'upsert', 'delete'
]);

// ── Escritura ──────────────────────────────────────────────────────────────────

/** Cifra/hashea los campos del modelo en un objeto `data` (create o update) y sigue por las relaciones. */
export function sealData(model: string, data: Data, mode: 'create' | 'update'): Data {
  const out: Data = { ...data };
  for (const { field, hash } of ENCRYPTED_FIELDS[model] ?? []) {
    if (!(field in out)) continue;
    // update admite { set: valor }
    const raw = isObject(out[field]) && 'set' in (out[field] as Data) ? (out[field] as Data).set : out[field];
    if (typeof raw === 'string' && raw !== '') {
      out[field] = sealValue(raw);
      if (hash) out[hash] = hashValue(raw);
    } else if (raw === null) {
      out[field] = null;
      if (hash) out[hash] = null;
    }
  }
  if (mode === 'create' && hasOrigin(model)) stampOrigin(out);
  for (const [key, target] of Object.entries(relationsOf(model))) {
    if (isObject(out[key])) out[key] = sealNested(target, out[key] as Data);
  }
  return out;
}

/** Operaciones anidadas de una relación: create, createMany, connectOrCreate, update, updateMany, upsert. */
function sealNested(target: string, ops: Data): Data {
  const out: Data = { ...ops };
  const map = (v: unknown, fn: (d: Data) => Data) => (Array.isArray(v) ? v.map(x => (isObject(x) ? fn(x) : x)) : isObject(v) ? fn(v) : v);
  if ('create' in out) out.create = map(out.create, d => sealData(target, d, 'create'));
  if (isObject(out.createMany)) {
    out.createMany = { ...out.createMany, data: map(out.createMany.data, d => sealData(target, d, 'create')) };
  }
  if ('connectOrCreate' in out) {
    out.connectOrCreate = map(out.connectOrCreate, c => ({ ...c, create: isObject(c.create) ? sealData(target, c.create, 'create') : c.create }));
  }
  // update to-one: { data } o los campos directo; to-many: [{ where, data }]
  if ('update' in out) out.update = map(out.update, u => (isObject(u.data) ? { ...u, data: sealData(target, u.data, 'update') } : sealData(target, u, 'update')));
  if ('updateMany' in out) out.updateMany = map(out.updateMany, u => ({ ...u, data: isObject(u.data) ? sealData(target, u.data, 'update') : u.data }));
  if ('upsert' in out) {
    out.upsert = map(out.upsert, u => ({
      ...u,
      create: isObject(u.create) ? sealData(target, u.create, 'create') : u.create,
      update: isObject(u.update) ? sealData(target, u.update, 'update') : u.update
    }));
  }
  return out;
}

function stampOrigin(data: Data): void {
  const origin = requestContext.originFromContext();
  if (data.originSessionId == null && origin.originSessionId != null) data.originSessionId = origin.originSessionId;
  if (data.originCorrelationId == null && origin.originCorrelationId != null) data.originCorrelationId = origin.originCorrelationId;
}

// ── Filtros ────────────────────────────────────────────────────────────────────

/** Lanza si un `where` filtra por un campo cifrado (también en AND/OR/NOT y filtros de relación). */
export function assertWhereSearchable(model: string, where: unknown): void {
  if (!isObject(where)) return;
  for (const { field, hash } of ENCRYPTED_FIELDS[model] ?? []) {
    if (field in where) {
      const hint = hash ? `Filtrar por ${hash} con hashValue() (shared/database/pii-fields).` : 'Este campo no tiene hash de búsqueda.';
      throw new Error(`Prisma: filtrar ${model}.${field} no funciona (cifrado con IV aleatorio, nunca coincide). ${hint}`);
    }
  }
  for (const k of ['AND', 'OR', 'NOT']) {
    if (k in where) asList(where[k]).forEach(w => assertWhereSearchable(model, w));
  }
  for (const [key, target] of Object.entries(relationsOf(model))) {
    const f = where[key];
    if (!isObject(f)) continue;
    const ops = ['some', 'every', 'none', 'is', 'isNot'].filter(o => o in f);
    if (ops.length) ops.forEach(o => assertWhereSearchable(target, f[o]));
    else assertWhereSearchable(target, f);
  }
}

// ── Lectura ────────────────────────────────────────────────────────────────────

/** Descifra (en el lugar) las filas devueltas, siguiendo las relaciones incluidas. */
export function openResult(model: string, result: unknown): unknown {
  if (Array.isArray(result)) {
    result.forEach(r => openResult(model, r));
    return result;
  }
  if (!isObject(result)) return result;
  for (const { field } of ENCRYPTED_FIELDS[model] ?? []) {
    const v = result[field];
    if (typeof v === 'string' && v !== '') result[field] = openValue(v);
  }
  for (const [key, target] of Object.entries(relationsOf(model))) {
    if (key in result) openResult(target, result[key]);
  }
  return result;
}

// ── Argumentos de cada operación ───────────────────────────────────────────────

export function prepareArgs(model: string, operation: string, args: Data | undefined): Data | undefined {
  if (!args) return args;
  const out: Data = { ...args };
  if ('where' in out) assertWhereSearchable(model, out.where);
  switch (operation) {
    case 'create':
      out.data = sealData(model, out.data as Data, 'create');
      break;
    case 'createMany':
    case 'createManyAndReturn':
      out.data = asList(out.data).map(d => sealData(model, d as Data, 'create'));
      break;
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      out.data = sealData(model, out.data as Data, 'update');
      break;
    case 'upsert':
      out.create = sealData(model, out.create as Data, 'create');
      out.update = sealData(model, out.update as Data, 'update');
      break;
    default:
  }
  return out;
}

/** Extensión de consulta: cifrado de PII, filtros seguros y origen de sesión. */
export const piiExtension = Prisma.defineExtension({
  name: 'pii-origin-session',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(prepareArgs(model, operation, args as Data | undefined) as typeof args);
        return RETURNS_RECORDS.has(operation) ? openResult(model, result) : result;
      }
    }
  }
});

export default { piiExtension, sealData, openResult, assertWhereSearchable, prepareArgs };
