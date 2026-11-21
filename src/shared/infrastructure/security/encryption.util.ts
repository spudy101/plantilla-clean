// src/utils/encryption.util.ts
// ACTUALIZADO: correcciones de seguridad importantes
//
// Cambios:
//   1. encrypt() ahora usa IV ALEATORIO por operación (no el IV fijo del .env)
//      Formato de salida: `${ivHex}:${ciphertextHex}` (self-contained)
//   2. decrypt() detecta automáticamente si recibe formato nuevo o legado
//   3. AES_IV del .env ya NO se usa para cifrado (solo compatibilidad legado)
//   4. Algoritmo cambiado a AES-256-GCM (AEAD — integridad garantizada)
//      para nuevos cifrados. CBC mantenido para decrypt legado.
//   5. generateHmac() → nueva firma para timestamp validation en mobile
//      (reemplaza el AES-encrypt del timestamp)
//
// IMPORTANTE PARA EL MOBILE:
//   El x-timestamp ya no se envía cifrado con AES.
//   El mobile envía:
//     - Header x-timestamp: <unix ms en texto plano>
//     - Header x-signature: HMAC-SHA256(timestamp + ':' + method + ':' + path, HMAC_SECRET)
//   El HMAC_SECRET se configura en Secrets Manager y el mobile lo obtiene
//   de forma segura en el primer login o a través del backend.

import crypto from 'node:crypto';
import constantsModule from '../config';
const { encryption } = constantsModule;

const AES_KEY = Buffer.from(encryption.aesKey, 'hex'); // 32 bytes
// Viene de ENCRYPTION_ALGORITHM (.env) o default 'aes-256-gcm'. Es un modo AEAD (GCM): usa authTag.
const ALGORITHM = encryption.algorithm as crypto.CipherGCMTypes;
const LEGACY_ALGO = 'aes-256-cbc'; // Para descifrar datos existentes en BD — siempre fijo
const API_KEY_RANDOM_BYTES = 12;
const FORMATE_TYPE = 3;

// El IV del .env ya no se usa para cifrado nuevo.
// Se mantiene solo para descifrar datos legado que tenían IV fijo.
const LEGACY_IV = Buffer.from(encryption.aesIv, 'hex'); // 16 bytes

class EncryptionUtil {
  // ============================================================
  // CIFRADO/DESCIFRADO DE CAMPOS SENSIBLES EN BD
  // ============================================================

  /**
   * Cifra datos con AES-256-GCM usando un IV aleatorio por operación.
   * Formato de salida: `${iv}:${authTag}:${ciphertext}` (todo en hex)
   *
   * Este formato es self-contained: para descifrar solo necesitas la llave.
   * No necesitas el IV del .env.
   *
   * Uso: cifrar nationalId, números de cuenta, datos sensibles en BD.
   *
   * @param {string} data - Texto plano a cifrar
   * @returns {string}    - `ivHex:authTagHex:ciphertextHex`
   */
  /** Cifra con AES-GCM → `iv:authTag:ciphertext` (hex). null/undefined se devuelven tal cual. */
  static encrypt(data: null | undefined): null | undefined;
  static encrypt(data: unknown): string;
  static encrypt(data: unknown): string | null | undefined {
    if (data === null || data === undefined) {
      return data;
    }

    const iv = crypto.randomBytes(API_KEY_RANDOM_BYTES); // GCM recomienda 12 bytes
    const cipher = crypto.createCipheriv(ALGORITHM, AES_KEY, iv);

    const ciphertext = Buffer.concat([cipher.update(String(data), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  /**
   * Descifra datos. Detecta automáticamente formato nuevo (GCM) o legado (CBC).
   *
   * Formato nuevo (GCM):  `ivHex:authTagHex:ciphertextHex` (3 partes con ':')
   * Formato legado (CBC): `ciphertextHex` (sin separadores, IV fijo del .env)
   *
   * @param {string} encryptedData
   * @returns {string} Texto plano
   */
  /** Descifra `iv:authTag:ciphertext` (GCM) o el formato legado (CBC con IV fijo). Vacío → tal cual. */
  static decrypt<T extends null | undefined | ''>(encryptedData: T): T;
  static decrypt(encryptedData: string): string;
  static decrypt(encryptedData: string | null | undefined): string | null | undefined;
  static decrypt(encryptedData: string | null | undefined): string | null | undefined {
    if (!encryptedData) {
      return encryptedData;
    }

    const parts = encryptedData.split(':');

    // Formato nuevo: iv:authTag:ciphertext
    if (parts.length === FORMATE_TYPE) {
      const [ivHex = '', authTagHex = '', ciphertextHex = ''] = parts;
      return EncryptionUtil._decryptGcm(ivHex, authTagHex, ciphertextHex);
    }

    // Formato legado: ciphertext solo (IV fijo del .env, AES-CBC)
    return EncryptionUtil._decryptLegacyCbc(encryptedData);
  }

  /**
   * @private
   */
  static _decryptGcm(ivHex: string, authTagHex: string, ciphertextHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, AES_KEY, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * @private — Solo para datos existentes en BD con formato antiguo
   */
  static _decryptLegacyCbc(ciphertextHex: string): string {
    const decipher = crypto.createDecipheriv(LEGACY_ALGO, AES_KEY, LEGACY_IV);
    return decipher.update(ciphertextHex, 'hex', 'utf8') + decipher.final('utf8');
  }

  // ============================================================
  // HMAC — validación de requests desde mobile (anti-replay)
  // ============================================================

  /**
   * Genera un HMAC-SHA256 para firmar requests del mobile.
   *
   * El mobile llama a esta función con su HMAC_SECRET para generar
   * la firma del header x-signature.
   *
   * Firma sobre: `${timestamp}:${method}:${path}`
   * Ejemplo:     `1736000000000:POST:/api/v1/transactions`
   *
   * @param {string|number} timestamp - Unix ms (Date.now())
   * @param {string} method           - HTTP method en mayúsculas
   * @param {string} path             - Path de la URL (sin query string)
   * @param {string} secret           - HMAC_SECRET del Secrets Manager
   * @returns {string} HMAC en hex
   */
  static generateRequestHmac(timestamp: string | number, method: string, path: string, secret: string): string {
    const payload = `${timestamp}:${method.toUpperCase()}:${path}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Verifica un HMAC de request.
   * Usa comparación en tiempo constante para evitar timing attacks.
   *
   * @param {string} received  - HMAC recibido en x-signature
   * @param {string} expected  - HMAC calculado localmente
   * @returns {boolean}
   */
  static verifyRequestHmac(received: string | null | undefined, expected: string | null | undefined): boolean {
    if (!received || !expected) {
      return false;
    }
    try {
      const a = Buffer.from(received, 'hex');
      const b = Buffer.from(expected, 'hex');
      if (a.length !== b.length) {
        return false;
      }
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ============================================================
  // UTILIDADES GENERALES
  // ============================================================

  /**
   * Descifra silenciosamente — retorna el valor original si falla (datos no cifrados o nulos).
   * Usar en DTOs donde el hook afterFind puede no haberse ejecutado en modelos anidados.
   */
  /** Descifra si puede; si el valor no está cifrado (o es inválido) lo devuelve intacto. */
  static safeDecrypt<T>(value: T): T | string {
    if (!value || typeof value !== 'string') {
      return value;
    }
    try {
      return EncryptionUtil.decrypt(value);
    } catch {
      return value;
    }
  }

  /**
   * Genera un hash SHA-256 (para referencias, no para contraseñas).
   */
  static generateHash(data: unknown, algorithm = 'sha256'): string {
    return crypto.createHash(algorithm).update(String(data)).digest('hex');
  }

  /**
   * Genera un HMAC genérico.
   */
  static generateHmac(data: unknown, secret: string, algorithm = 'sha256'): string {
    return crypto.createHmac(algorithm, secret).update(String(data)).digest('hex');
  }

  /**
   * Genera un string aleatorio seguro en hex.
   */
  static generateRandomString(length = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

export default EncryptionUtil;
