/**
 * [RF-USR-01] | CA-06 | Catálogo único de campos PII que se enmascaran en las respuestas.
 *
 * Fuente de verdad compartida por las tres capas del enmascaramiento:
 *   1. Los DTOs, que enmascaran en origen con MaskingUtil.
 *   2. MaskingUtil.redactPayload(), que recorre los JSONB propios (metadata de notificaciones,
 *      details de auditoría, snapshots probatorios, transferData…).
 *   3. PiiMaskingMiddleware, la red de seguridad enganchada en ApiResponse.success().
 *
 * Agregar un campo nuevo aquí lo cubre en las tres capas a la vez.
 *
 * El RF pide documento, celular y correo (últimos 4). Se suman TIN, tarjeta y número de cuenta,
 * que el repo ya venía enmascarando en algunas superficies y no en otras.
 */

// Tipos de máscara disponibles (implementados en shared/utils/masking.util.js).
const PII_MASK_TYPES = {
  DOCUMENT: 'document', // últimos 4 dígitos
  PHONE: 'phone', // últimos 4 dígitos
  EMAIL: 'email', // primer carácter del local + dominio
  ACCOUNT: 'account', // últimos 4 dígitos
  AUTO: 'auto' // se decide por la forma del valor (email / teléfono / documento); si no encaja, se deja intacto
} as const;

type PiiMaskType = (typeof PII_MASK_TYPES)[keyof typeof PII_MASK_TYPES];

/**
 * Normaliza el nombre de una key para comparar sin importar la convención:
 * `national_id`, `nationalId` y `NationalID` colapsan en `nationalid`.
 */
function normalizePiiKey(key: unknown): string {
  if (typeof key !== 'string') {
    return '';
  }
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Mapa key normalizada → tipo de máscara. La comparación es EXACTA sobre la key normalizada,
// nunca por substring: así `email` se enmascara pero `emailVerifiedAt` o `isEmailVerified` no se tocan.
const PII_FIELD_MASKS: Record<string, PiiMaskType> = {
  // --- Documento de identidad ---
  nationalid: PII_MASK_TYPES.DOCUMENT,
  oldnationalid: PII_MASK_TYPES.DOCUMENT,
  newnationalid: PII_MASK_TYPES.DOCUMENT,
  numerodocumento: PII_MASK_TYPES.DOCUMENT,
  documentnumber: PII_MASK_TYPES.DOCUMENT,
  identificacion: PII_MASK_TYPES.DOCUMENT,

  // --- Identificación tributaria ---
  ustin: PII_MASK_TYPES.DOCUMENT,
  tin: PII_MASK_TYPES.DOCUMENT,
  taxid: PII_MASK_TYPES.DOCUMENT,

  // --- Correo ---
  email: PII_MASK_TYPES.EMAIL,
  oldemail: PII_MASK_TYPES.EMAIL,
  newemail: PII_MASK_TYPES.EMAIL,
  emailaddress: PII_MASK_TYPES.EMAIL,
  correo: PII_MASK_TYPES.EMAIL,
  correoelectronico: PII_MASK_TYPES.EMAIL,
  institutionalemail: PII_MASK_TYPES.EMAIL,
  studentemail: PII_MASK_TYPES.EMAIL,
  reportemail: PII_MASK_TYPES.EMAIL,
  technicalemail: PII_MASK_TYPES.EMAIL,
  contactemail: PII_MASK_TYPES.EMAIL,
  useremail: PII_MASK_TYPES.EMAIL,

  // --- Teléfono ---
  phone: PII_MASK_TYPES.PHONE,
  phonenumber: PII_MASK_TYPES.PHONE,
  phoneprimary: PII_MASK_TYPES.PHONE,
  phonesecondary: PII_MASK_TYPES.PHONE,
  phoneprimaryfull: PII_MASK_TYPES.PHONE,
  phonesecondaryfull: PII_MASK_TYPES.PHONE,
  referencephone: PII_MASK_TYPES.PHONE,
  contactphone: PII_MASK_TYPES.PHONE,
  officialcontactphone: PII_MASK_TYPES.PHONE,
  telefono: PII_MASK_TYPES.PHONE,
  celular: PII_MASK_TYPES.PHONE,
  movil: PII_MASK_TYPES.PHONE,

  // --- Cuentas y tarjetas ---
  accountnumber: PII_MASK_TYPES.ACCOUNT,
  numerocuenta: PII_MASK_TYPES.ACCOUNT,
  bankaccount: PII_MASK_TYPES.ACCOUNT,
  cuentabancaria: PII_MASK_TYPES.ACCOUNT,
  disbursementaccount: PII_MASK_TYPES.ACCOUNT,
  cardnumber: PII_MASK_TYPES.ACCOUNT,
  numerotarjeta: PII_MASK_TYPES.ACCOUNT,

  // --- Valores polimórficos (el contenido decide la máscara) ---
  // contactValue = destino de un OTP (correo o celular).
  // previousValue/newValue = diff de user_change_logs: puede ser un correo, un documento… o
  // un estado de cuenta ('activo'), que AUTO deja intacto por no tener forma de PII.
  contactvalue: PII_MASK_TYPES.AUTO,
  previousvalue: PII_MASK_TYPES.AUTO,
  newvalue: PII_MASK_TYPES.AUTO
};

/**
 * Subárboles que NO se recorren: son la respuesta cruda de un tercero, tal como la devolvió.
 *
 * Decisión del dev (2026-07-21): esta pasada enmascara solo lo que devolvemos NOSOTROS desde
 * nuestra BD vía DTO. Los payloads de integraciones quedan intactos y anotados como deuda
 * en PLAN.md §4.5 — tocarlos exige decidir antes qué necesita soporte técnico para depurar.
 */
const PII_RAW_PAYLOAD_KEYS: string[] = [
  'rawdata',
  'rawrequest',
  'rawresponse',
  'rawpayload',
  'failurerequest',
  'failureresponse',
  'requestpayload',
  'responsepayload'
];

export default {
  PII_MASK_TYPES,
  PII_FIELD_MASKS,
  PII_RAW_PAYLOAD_KEYS,
  normalizePiiKey
};
