// Zod configurado para el proyecto: mensajes en español.
// Importar SIEMPRE `z` desde acá (no desde 'zod'), así todo esquema hereda la configuración.
import { z } from 'zod';

z.config(z.locales.es());

/** Pista para el usuario sobre cómo corregir el campo; llega al front en `errors[].hint`. */
export interface FieldMeta {
  hint?: string;
  /** Formato OpenAPI cuando el esquema no lo deduce (p. ej. una fecha que se convierte a Date). */
  format?: string;
  description?: string;
  example?: unknown;
}

/** Adjunta la pista (y opcionalmente descripción y ejemplo para la documentación) a un esquema. */
export function withHint<T extends z.ZodType>(schema: T, meta: FieldMeta): T {
  return schema.meta(meta as Record<string, unknown>);
}

export { z };
