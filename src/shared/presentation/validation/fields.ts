// shared/validation/fields.ts — campos genéricos reutilizables (sin negocio), con los mismos mensajes y
// pistas que tenía BaseValidator. Los campos de un dominio (documento, nombres, contraseña…) viven en su
// módulo. Los de query/params aceptan el valor como texto y lo convierten (número, fecha, booleano).
import { z, withHint } from './z';
import constantsModule from '../../infrastructure/config';
const { REGEX } = constantsModule;
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type SortOrder } from '../../application/pagination';

const UUID_HINT = 'El identificador debe ser un UUID válido';

/** UUID requerido. */
export const uuid = (label: string) =>
  withHint(z.uuid({ error: issue => (issue.input === undefined || issue.input === '' ? `${label} es requerido` : `${label} debe ser un UUID válido`) }), {
    hint: UUID_HINT
  });

/** UUID opcional (puede faltar o venir en null). */
export const optionalUuid = (label: string) => withHint(uuid(label).nullish(), { hint: UUID_HINT });

interface TextOptions {
  min?: number;
  max: number;
}

/** Texto obligatorio (recortado), entre `min` (1 por defecto) y `max` caracteres. */
export const text = (label: string, { min = 1, max }: TextOptions) =>
  withHint(
    z
      .string({ error: `${label} es requerido` })
      .trim()
      .min(min, { error: min === 1 ? `${label} es requerido` : `${label} debe tener al menos ${min} caracteres` })
      .max(max, { error: `${label} admite máximo ${max} caracteres` }),
    { hint: min === 1 ? `Escribí hasta ${max} caracteres` : `Escribí entre ${min} y ${max} caracteres` }
  );

/** Texto opcional: puede faltar o venir en null. */
export const optionalText = (label: string, max: number) =>
  withHint(z.string({ error: `${label} debe ser texto` }).trim().max(max, { error: `${label} admite máximo ${max} caracteres` }).nullish(), {
    hint: `Escribí hasta ${max} caracteres u omití el campo`
  });

/** Entero ≥ 1. Acepta el número como texto (query string / multipart). */
export const positiveInt = (label: string) =>
  withHint(
    z.coerce
      .number({ error: `${label} debe ser un número` })
      .int({ error: `${label} debe ser un entero` })
      .min(1, { error: `${label} debe ser mayor a 0` }),
    { hint: 'Usá un entero desde 1' }
  );

/** Booleano estricto (true/false en JSON). */
export const bool = (label: string) => z.boolean({ error: `${label} debe ser true o false` });

const BOOL_STRINGS: Record<string, boolean> = { true: true, false: false, 1: true, 0: false };

/** Booleano que acepta true/false o su texto ('true'/'false'/'1'/'0'): query string y JSON. */
export const flexibleBool = (label = 'El valor') =>
  withHint(
    z.preprocess(
      v => (typeof v === 'string' && v.trim().toLowerCase() in BOOL_STRINGS ? BOOL_STRINGS[v.trim().toLowerCase()] : v),
      z.boolean({ error: `${label} debe ser un valor booleano` })
    ),
    { hint: 'Ingresá true o false' }
  );

/** Booleano opcional (true/false o su texto). */
export const optionalBool = (label = 'El valor') => withHint(flexibleBool(label).nullish(), { hint: 'Ingresá true o false' });

/** Fecha ISO 8601 opcional → Date. */
export const optionalIsoDate = (label = 'La fecha') =>
  withHint(
    z.preprocess(
      v => (v === '' ? undefined : v),
      z
        .string({ error: `${label} debe ser una fecha válida (YYYY-MM-DD)` })
        .refine(s => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), { error: `${label} debe ser una fecha válida (YYYY-MM-DD)` })
        .transform(s => new Date(s))
        .nullish()
    ),
    { hint: 'Ingresá una fecha válida en formato YYYY-MM-DD', format: 'date' }
  );

/** Email. */
export const email = (label = 'El email') =>
  withHint(
    z
      .string({ error: `${label} es requerido` })
      .trim()
      .min(1, { error: `${label} es requerido` })
      .max(255, { error: 'El email no puede superar los 255 caracteres' })
      .regex(REGEX.EMAIL, { error: 'Debe ser un email válido' }),
    { hint: 'Ingresá un correo válido, por ejemplo usuario@dominio.com' }
  );

/** Uno de los valores permitidos. */
export const oneOf = <T extends readonly [string, ...string[]]>(label: string, values: T) =>
  withHint(z.enum(values, { error: `${label} debe ser: ${values.join(', ')}` }), { hint: `Indicá uno de: ${values.join(', ')}` });

const PAGE_ERROR = 'La página debe ser un número entero mayor a 0';
const LIMIT_ERROR = `El límite debe ser un número entre 1 y ${MAX_PAGE_SIZE}`;
const snake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/**
 * Solo page/limit (con default), para un listado de **orden fijo**: no acepta sortBy/order porque no los
 * aplicaría. El service informa su orden en la metadata. Para el resto, `pageQuery`.
 */
export const pagingQuery = {
  page: withHint(z.coerce.number({ error: PAGE_ERROR }).int({ error: PAGE_ERROR }).min(1, { error: PAGE_ERROR }).default(1), {
    hint: 'Ingresá un número de página mayor a 0'
  }),
  limit: withHint(
    z.coerce
      .number({ error: LIMIT_ERROR })
      .int({ error: LIMIT_ERROR })
      .min(1, { error: LIMIT_ERROR })
      .max(MAX_PAGE_SIZE, { error: LIMIT_ERROR })
      .default(DEFAULT_PAGE_SIZE),
    { hint: `Ingresá un límite entre 1 y ${MAX_PAGE_SIZE}` }
  )
};

/**
 * page/limit/sortBy/order de un listado paginado (query). Cada listado declara **por qué campos se puede
 * ordenar** (pocos, idealmente con índice) y su orden por defecto: un `sortBy` fuera de la lista es un 422,
 * nunca se ignora en silencio. Ya parseado: page/limit con default, `sortBy` en camelCase (también acepta
 * el nombre de columna, `created_at`) y `order` en mayúsculas. Lo consume shared/http/pagination.ts.
 *   export const XListQuery = input({ ...pageQuery(['createdAt', 'name'], { sortBy: 'createdAt' }), ...filtros });
 */
export const pageQuery = <const S extends readonly [string, ...string[]]>(sortable: S, defaults: { sortBy: S[number]; order?: SortOrder }) => {
  const accepted = [...new Set([...sortable, ...sortable.map(snake)])] as [string, ...string[]];
  const order = defaults.order ?? 'DESC';
  return {
    ...pagingQuery,
    sortBy: withHint(
      z
        .enum(accepted, { error: `sortBy debe ser uno de: ${sortable.join(', ')}` })
        .transform(v => camel(v) as S[number])
        // el genérico S no se reduce dentro de Zod: el default es un S[number] por la firma
        .default(defaults.sortBy as never),
      { hint: `Ordená por uno de: ${sortable.join(', ')}`, description: `Campo de orden (por defecto ${defaults.sortBy}).` }
    ),
    order: withHint(
      z
        .enum(['ASC', 'DESC', 'asc', 'desc'], { error: 'El orden debe ser ASC o DESC' })
        .transform(v => v.toUpperCase() as SortOrder)
        .default(order),
      { hint: 'Indicá ASC o DESC', description: `Dirección del orden (por defecto ${order}).` }
    )
  };
};

/** Término de búsqueda (query). */
export const searchQuery = {
  search: withHint(z.string({ error: 'search debe ser un string' }).trim().max(100, { error: 'El término de búsqueda no puede superar 100 caracteres' }).optional(), {
    hint: 'Usá hasta 100 caracteres en la búsqueda'
  })
};

/**
 * Objeto de entrada. Durante la migración desde express-validator los esquemas aceptan campos que no
 * declaran (como antes): hay services que leen alguno sin regla. Para código nuevo, preferí z.object
 * (descarta lo que no está declarado).
 */
export const input = <T extends z.core.$ZodLooseShape>(shape: T) => z.looseObject(shape);

/** Archivo de un multipart (req.files[campo][0]): presencia, tipo y tamaño. */
export const fileField = (field: string, { mimeTypes, maxSizeMb = 10 }: { mimeTypes: readonly string[]; maxSizeMb?: number }) => {
  const message = `El archivo debe ser ${mimeTypes.join(', ')} y no superar ${maxSizeMb}MB`;
  const maxBytes = maxSizeMb * 1024 * 1024;
  return withHint(
    z
      .array(
        z.object({ mimetype: z.string(), size: z.number() }).refine(f => mimeTypes.includes(f.mimetype) && f.size <= maxBytes, { error: message }),
        { error: message }
      )
      .min(1, { error: message }),
    { hint: `Adjuntá un archivo ${mimeTypes.join(', ')} de hasta ${maxSizeMb}MB en el campo "${field}"` }
  );
};

/** Texto opcional que debe ser uno de `values` (lista calculada en tiempo de ejecución, p. ej. de un catálogo). */
export const optionalInList = (values: readonly string[], { message, hint }: { message: string; hint: string }) =>
  withHint(
    z
      .string({ error: message })
      .trim()
      .refine(v => values.includes(v), { error: message })
      .optional(),
    { hint }
  );

/** Texto opcional de hasta `max` caracteres (filtros de query). */
export const optionalMax = (field: string, max: number) =>
  withHint(z.string().trim().max(max, { error: `${field} no puede superar ${max} caracteres` }).optional(), { hint: `Escribí hasta ${max} caracteres` });
