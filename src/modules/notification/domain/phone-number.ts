// Teléfonos de los SMS: el proveedor necesita E.164 (+56912345678); el contacto guarda el número local y el
// prefijo del país aparte.

/** El número en E.164: el prefijo del país + el número local. Si ya viene con +, o no hay prefijo, tal cual. */
export function toE164(localNumber: string, prefix: string | null | undefined): string {
  if (!localNumber || localNumber.startsWith('+') || !prefix) {
    return localNumber;
  }
  return `${prefix}${localNumber}`;
}
