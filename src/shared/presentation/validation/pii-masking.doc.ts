/**
 * [RF-USR-01] | CA-06 | Textos compartidos para documentar el enmascaramiento PII en Swagger.
 *
 * Toda respuesta de la API pasa por `ApiResponse.success()`, que aplica la red de seguridad
 * (`PiiMaskingMiddleware`) sobre `data` y `metadata`. Los DTOs además enmascaran en origen.
 * Estas constantes se usan en la `description` de cada propiedad afectada para que el front sepa,
 * campo por campo, que el valor llega enmascarado y NO puede reenviarse tal cual en un PUT/POST.
 *
 * Los campos de REQUEST (body/query) NUNCA llevan estos textos: la entrada va siempre completa.
 */

const MASKED_NOTE = 'El valor completo nunca sale por la API; no lo reenvíes en un PUT/POST.';

const MASKED_DOCUMENT_DESC = `**Enmascarado** — solo los últimos 4 dígitos (RF-USR-01 CA-6). ${MASKED_NOTE}`;

const MASKED_PHONE_DESC = `**Enmascarado** — solo los últimos 4 dígitos (RF-USR-01 CA-6). ${MASKED_NOTE}`;

const MASKED_EMAIL_DESC = `**Enmascarado** — primer carácter del local + dominio, p. ej. \`****n@gmail.com\` (RF-USR-01 CA-6). ${MASKED_NOTE}`;

const MASKED_ACCOUNT_DESC = `**Enmascarado** — \`****\` + últimos 4 dígitos (RF-USR-01 CA-6). ${MASKED_NOTE}`;

/** Para JSONB propios (metadata, details, snapshots) que pasan por `MaskingUtil.redactPayload`. */
const REDACTED_PAYLOAD_DESC =
  'Las claves sensibles de este objeto (documento, correo, teléfono, TIN, número de cuenta) salen ' +
  '**enmascaradas** a cualquier nivel de anidación (RF-USR-01 CA-6).';

/** Para las rutas exentas (registro), donde el dato sí sale completo. */
const UNMASKED_ROUTE_DESC =
  '⚠️ Endpoint **exento** del enmascaramiento global: devuelve el dato completo porque el usuario está ' +
  'ingresando o confirmando sus propios datos durante el registro.';

export default {
  MASKED_DOCUMENT_DESC,
  MASKED_PHONE_DESC,
  MASKED_EMAIL_DESC,
  MASKED_ACCOUNT_DESC,
  REDACTED_PAYLOAD_DESC,
  UNMASKED_ROUTE_DESC
};
