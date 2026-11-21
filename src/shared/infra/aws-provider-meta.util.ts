// Código de error normalizado de un error del AWS SDK v3 (ej: 'MessageRejected', 'NoSuchKey') o, si no
// hay nombre, el status HTTP del $metadata. Va en la línea de log de callProvider y en el código de error
// que el envío de una notificación guarda en la fila (email_error_code / push_error_code).
function awsErrorCode(error: unknown): string | number | null {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null | undefined;
  return e?.name || e?.$metadata?.httpStatusCode || null;
}

export default { awsErrorCode };
