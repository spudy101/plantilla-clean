// Utilidad de hash determinístico para búsquedas en BD de campos cifrados.
//
// PROBLEMA que resuelve:
//   AES-256-GCM usa IV aleatorio → el mismo valor cifrado dos veces produce
//   resultados distintos → no se puede hacer WHERE campo = encrypt(valor).
//
// SOLUCIÓN:
//   Para cada campo sensible buscable, guardamos un hash gemelo:
//     campo          → AES-256-GCM (IV random)  → para mostrar al usuario
//     campo_hash     → HMAC-SHA256(valor, PEPPER) → para búsquedas WHERE
//
//   HMAC-SHA256 con PEPPER secreto es determinístico (mismo input = mismo hash)
//   pero sin el PEPPER es computacionalmente imposible revertir.
//
// CAMPOS que usan este patrón:
//   persons.national_id            → persons.national_id_hash
//   person_contacts.email          → person_contacts.email_hash
//   person_contacts.phone_primary  → person_contacts.phone_primary_hash
//   person_contacts.phone_secondary → person_contacts.phone_secondary_hash
//   user_login_attempts.national_id → user_login_attempts.national_id_hash
//
// CONFIGURACIÓN requerida en .env:
//   HASH_PEPPER=<string secreto largo — mínimo 32 chars>
//   Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

import crypto from 'node:crypto';

// El PEPPER se carga una sola vez al iniciar el proceso.
// Si no existe, el servidor no debe arrancar (ver validación en config.js).
const PEPPER = process.env.HASH_PEPPER;

class HashUtil {
  /**
   * Genera un HMAC-SHA256 determinístico del valor dado.
   * Usado exclusivamente para poblar columnas _hash en BD.
   *
   * @param {string|null|undefined} value - Valor en texto plano
   * @returns {string|null} - 64 chars hex, o null si el valor es nulo
   */
  /** HMAC-SHA256 con pepper, normalizado (trim + minúsculas). null si el valor está vacío. */
  static hashForSearch(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (!PEPPER) {
      throw new Error('HASH_PEPPER no está configurado. Agrega HASH_PEPPER a tu .env');
    }

    return crypto.createHmac('sha256', PEPPER).update(String(value).trim().toLowerCase()).digest('hex');
  }

  /**
   * Verifica si un valor en texto plano coincide con un hash almacenado.
   * Usa comparación en tiempo constante para evitar timing attacks.
   *
   * @param {string} plainValue    - Valor en texto plano
   * @param {string} storedHash    - Hash almacenado en BD
   * @returns {boolean}
   */
  static verify(plainValue: unknown, storedHash: string | null | undefined): boolean {
    if (!plainValue || !storedHash) {
      return false;
    }

    const computedHash = HashUtil.hashForSearch(plainValue);
    if (!computedHash) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
      return false;
    }
  }
}

export default HashUtil;
