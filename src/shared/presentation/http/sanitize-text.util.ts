/**
 * C-8 — Sanitización de campos de texto plano (XSS prevention)
 *
 * Los campos admin_detail de las acciones de rechazo son texto administrativo interno.
 * No deben contener HTML ni JavaScript. Este módulo provee una sanitización
 * server-side sin dependencias externas que:
 *   1. Elimina cualquier etiqueta HTML (<script>, <img>, <a>, etc.)
 *   2. Normaliza entidades HTML peligrosas
 *   3. Preserva el texto plano legible para los admins
 *
 * Contexto: los campos admin_detail se renderizan en el admin UI para explicar
 * internamente el motivo de un rechazo. Sin sanitización, un admin con acceso
 * de escritura podría inyectar HTML/JS visible a todos los admins que lean el log.
 *
 * No usamos DOMPurify (solo funciona en browser) ni sanitize-html (dependencia
 * adicional no instalada). Esta implementación cubre el caso de uso concreto:
 * texto plano sin HTML, máximo 2000 caracteres.
 */

const HTML_TAG_REGEX = /<[^>]*>/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#x27;': "'",
  '&#x2F;': '/',
  '&#x60;': '`',
  '&#x3D;': '='
};

const MAX_TEXT_LENGTH = 2000;

/**
 * Elimina etiquetas HTML y normaliza el texto al contenido visible.
 * @param {string} text
 * @returns {string}
 */
function stripHtmlTags(text: string): string;
function stripHtmlTags<T>(text: T): T;
function stripHtmlTags(text: unknown): unknown {
  if (typeof text !== 'string') {
    return text;
  }
  return text.replace(HTML_TAG_REGEX, '');
}

/**
 * Decodifica entidades HTML escapadas antes de sanitizar,
 * para detectar intentos de evasión como &lt;script&gt;.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text: string): string;
function decodeHtmlEntities<T>(text: T): T;
function decodeHtmlEntities(text: unknown): unknown {
  if (typeof text !== 'string') {
    return text;
  }
  return text.replace(/&lt;|&gt;|&amp;|&quot;|&#x27;|&#x2F;|&#x60;|&#x3D;/g, match => HTML_ENTITY_MAP[match] ?? match);
}

/**
 * Sanitiza un campo de texto plano para almacenamiento seguro.
 * Elimina tags HTML, decodifica entidades y vuelve a stripear.
 * Trunca al máximo permitido.
 *
 * @param {string} text    - Texto de entrada (puede venir del admin UI)
 * @param {number} [maxLength=MAX_TEXT_LENGTH]
 * @returns {string|null}
 */
const sanitizePlainText = (text: unknown, maxLength = MAX_TEXT_LENGTH): string | null => {
  if (text === null || text === undefined) {
    return null;
  }
  if (typeof text !== 'string') {
    return String(text).slice(0, maxLength);
  }

  // Doble pasada: decodificar entidades primero, luego stripear
  const decoded = decodeHtmlEntities(text);
  const stripped = stripHtmlTags(decoded);
  const trimmed = stripped.trim();

  return trimmed.slice(0, maxLength);
};

export default { sanitizePlainText, stripHtmlTags, decodeHtmlEntities };
