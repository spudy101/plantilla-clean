// shared/validation/validate.ts — middleware de validación de la entrada con esquemas Zod.
//
//   router.put('/x', ..., validate({ body: ReplaceXBody }), XController.replace);
//
// Si algo no cumple → 422 con el formato de siempre: errors[] = { field, message, hint, value }. Si todo
// cumple, req.body / req.query / req.params quedan con el valor YA PARSEADO (recortado, convertido), así el
// controller recibe exactamente lo que dice el tipo del esquema.
import type { NextFunction, Request, Response } from 'express';
import type { z } from './z';
import AppError from '../http/app-error.util';

/** files: los archivos de un multipart (req.files de multer), para validar campo, cantidad y tipo. */
type Part = 'body' | 'query' | 'params' | 'files' | 'headers';
type Schemas = Partial<Record<Part, z.ZodType>>;

export interface ValidationErrorItem {
  field: string;
  message: string;
  hint: string | null;
  value: unknown;
}

/** El esquema del campo en `path` (atraviesa objetos, arrays y opcionales) para leer su pista. */
function schemaAt(schema: z.ZodType, path: readonly PropertyKey[]): z.ZodType | undefined {
  let current: z.ZodType | undefined = schema;
  for (const key of path) {
    current = unwrap(current);
    const def = (current as { def?: { type?: string; shape?: Record<string, z.ZodType>; element?: z.ZodType } } | undefined)?.def;
    if (def?.type === 'object') {
      current = def.shape?.[String(key)];
    } else if (def?.type === 'array') {
      current = def.element;
    } else {
      return undefined;
    }
  }
  return current;
}

/** Saca optional / nullable / default / pipe para llegar al esquema real. */
function unwrap(schema: z.ZodType | undefined): z.ZodType | undefined {
  let current = schema;
  for (let i = 0; i < 10 && current; i++) {
    const def = (current as { def?: { type?: string; innerType?: z.ZodType; in?: z.ZodType } }).def;
    if (def?.innerType) {
      current = def.innerType;
    } else if (def?.type === 'pipe' && def.in) {
      current = def.in;
    } else {
      break;
    }
  }
  return current;
}

function hintOf(schema: z.ZodType | undefined): string | null {
  for (const s of [schema, unwrap(schema)]) {
    const hint = (s?.meta?.() as { hint?: string } | undefined)?.hint;
    if (hint) {
      return hint;
    }
  }
  return null;
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<PropertyKey, unknown>)[key] : undefined), input);
}

export function formatIssues(schema: z.ZodType, input: unknown, issues: readonly z.core.$ZodIssue[]): ValidationErrorItem[] {
  return issues.map(issue => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
    hint: hintOf(schemaAt(schema, issue.path)),
    value: valueAt(input, issue.path)
  }));
}

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const errors: ValidationErrorItem[] = [];
    for (const part of ['headers', 'params', 'query', 'body', 'files'] as const) {
      const schema = schemas[part];
      if (!schema) {
        continue;
      }
      const input = (req as unknown as Record<Part, unknown>)[part];
      const result = schema.safeParse(input);
      if (result.success) {
        // files y headers no se reemplazan: el esquema solo mira una parte y el resto se sigue usando
        if (part !== 'files' && part !== 'headers') {
          (req as unknown as Record<Part, unknown>)[part] = result.data;
        }
      } else {
        errors.push(...formatIssues(schema, input, result.error.issues));
      }
    }
    return next(errors.length > 0 ? AppError.unprocessableEntity('Error de validación', errors) : undefined);
  };
}

/**
 * La query ya validada por `validate({ query: schema })`, con el tipo de salida de ese esquema (defaults
 * aplicados, valores convertidos). Se pasa el mismo esquema de la ruta para que el tipo no se desalinee:
 *   const result = await XService.list(validQuery(req, XListQuery), userId);
 */
export function validQuery<T extends z.ZodType>(req: Request, _schema: T): z.output<T> {
  return req.query as unknown as z.output<T>;
}

export default { validate, validQuery };
