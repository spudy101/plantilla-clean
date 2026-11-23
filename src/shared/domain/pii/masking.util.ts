// shared/domain/pii/masking.util.ts — enmascarado de datos personales (TypeScript puro: lo usan dominio y presentación)

import piiFieldsModule from '../constants/pii-fields';
const { PII_FIELD_MASKS, PII_MASK_TYPES, PII_RAW_PAYLOAD_KEYS, normalizePiiKey } = piiFieldsModule;

const VISIBLE_CHARS = 4;
const MASK_CHAR = '*';

// Tope de profundidad al recorrer JSONB propios (metadata, details, snapshots). Un objeto de
// negocio no anida más que esto; el tope evita recorridos patológicos y corta cualquier ciclo.
const MAX_REDACT_DEPTH = 8;

// Formas reconocidas por la máscara AUTO, para valores cuyo tipo depende del contenido
// (contactValue de un OTP, previousValue/newValue del diff de user_change_logs).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_OR_DOCUMENT_SHAPE = /^\+?[\d\s().-]{6,}$/;
// Las fechas NO se enmascaran (política declarada al cliente), pero una ISO como '1995-03-12'
// matchea la forma de teléfono/documento: se reconocen primero y pasan intactas.
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

class MaskingUtil {
  static maskDocumentId(value: unknown) {
    if (!value || typeof value !== 'string') {
      return '';
    }
    const clean = value.trim();
    if (clean.length <= VISIBLE_CHARS) {
      return clean;
    }
    return MASK_CHAR.repeat(clean.length - VISIBLE_CHARS) + clean.slice(-VISIBLE_CHARS);
  }

  static maskPhone(value: unknown) {
    if (!value || typeof value !== 'string') {
      return '';
    }
    const clean = value.trim();
    if (clean.length <= VISIBLE_CHARS) {
      return clean;
    }
    return MASK_CHAR.repeat(clean.length - VISIBLE_CHARS) + clean.slice(-VISIBLE_CHARS);
  }

  static maskEmail(value: unknown) {
    if (!value || typeof value !== 'string') {
      return '';
    }
    const atIndex = value.indexOf('@');
    if (atIndex <= 1) {
      return value;
    }
    const local = value.slice(0, atIndex);
    const domain = value.slice(atIndex);
    const visible = local.slice(-1);
    return MASK_CHAR.repeat(local.length - 1) + visible + domain;
  }

  // Cuentas bancarias y tarjetas: prefijo fijo de 4 asteriscos + últimos 4 (no revela la longitud).
  static maskAccount(value: unknown) {
    if (!value) {
      return '';
    }
    const clean = String(value).trim();
    if (clean.length <= VISIBLE_CHARS) {
      return MASK_CHAR.repeat(VISIBLE_CHARS);
    }
    return MASK_CHAR.repeat(VISIBLE_CHARS) + clean.slice(-VISIBLE_CHARS);
  }

  // Máscara por forma del valor: se usa donde una misma columna guarda cosas distintas.
  // Si el valor no tiene forma de PII (p. ej. 'activo' en un diff de estado) se devuelve intacto.
  static maskAuto(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      return value;
    }
    const clean = value.trim();
    if (ISO_DATE_SHAPE.test(clean)) {
      return value;
    }
    if (EMAIL_SHAPE.test(clean)) {
      return MaskingUtil.maskEmail(clean);
    }
    if (PHONE_OR_DOCUMENT_SHAPE.test(clean)) {
      return MaskingUtil.maskPhone(clean);
    }
    return value;
  }

  static maskByType(value: unknown, maskType: string): unknown {
    switch (maskType) {
      case PII_MASK_TYPES.DOCUMENT:
        return MaskingUtil.maskDocumentId(value);
      case PII_MASK_TYPES.PHONE:
        return MaskingUtil.maskPhone(value);
      case PII_MASK_TYPES.EMAIL:
        return MaskingUtil.maskEmail(value);
      case PII_MASK_TYPES.ACCOUNT:
        return MaskingUtil.maskAccount(value);
      case PII_MASK_TYPES.AUTO:
        return MaskingUtil.maskAuto(value);
      default:
        return value;
    }
  }

  /**
   * [RF-USR-01] | CA-06 | Redactor profundo por key.
   *
   * Recorre objetos y arrays planos enmascarando toda key del catálogo PII_FIELD_MASKS, a
   * cualquier profundidad. Pensado para los JSONB propios que hoy salen crudos: metadata de
   * notificaciones, details de audit_logs, personSnapshot del dossier, transferData…
   *
   * - No muta el original: devuelve estructuras nuevas.
   * - No entra en los subárboles de PII_RAW_PAYLOAD_KEYS (respuestas crudas de terceros).
   * - Solo recorre objetos planos y arrays; cualquier otra cosa (Date, Buffer, instancias de
   *   clase) se devuelve intacta para no romper su serialización.
   */
  static redactPayload(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined || depth > MAX_REDACT_DEPTH) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(item => MaskingUtil.redactPayload(item, depth + 1));
    }

    if (!MaskingUtil._isPlainObject(value)) {
      return value;
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = normalizePiiKey(key);

      if (PII_RAW_PAYLOAD_KEYS.includes(normalizedKey)) {
        redacted[key] = item;
        continue;
      }

      const maskType = PII_FIELD_MASKS[normalizedKey];
      if (maskType && typeof item === 'string') {
        redacted[key] = MaskingUtil.maskByType(item, maskType);
        continue;
      }

      redacted[key] = MaskingUtil.redactPayload(item, depth + 1);
    }
    return redacted;
  }

  static _isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
}

export default MaskingUtil;
