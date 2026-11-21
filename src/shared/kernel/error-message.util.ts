// shared/utils/error-message.util.ts
//
// Con `useUnknownInCatchVariables` (strict) el error de un `catch` es `unknown`: no se puede leer
// `.message` sin comprobar el tipo. Este helper centraliza esa comprobación para los logs.

/** Mensaje legible de cualquier valor lanzado (Error, string u otro). */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

/** `name` del error (p. ej. 'NoSuchKey' en errores del SDK de AWS), si existe. */
function errorName(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : undefined;
}

export default { errorMessage, errorName };
