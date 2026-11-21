import type { Request } from 'express';
import crypto from 'node:crypto';
import geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';

/**
 * DeviceFingerprintUtil
 *
 * Genera un hash estable del dispositivo basado SOLO en User-Agent normalizado.
 * Sin IP — así el fingerprint no cambia si el usuario cambia de red.
 *
 * También parsea el User-Agent y geolocaliza la IP para enriquecer
 * la información del dispositivo en base de datos.
 */
class DeviceFingerprintUtil {
  /**
   * Genera SHA-256 del User-Agent normalizado.
   * Estable entre sesiones del mismo navegador/dispositivo.
   *
   * @param {string} userAgent
   * @returns {string} hex de 64 caracteres
   */
  static generateHash(userAgent: string) {
    const normalized = DeviceFingerprintUtil._normalize(userAgent);
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Genera un nombre legible desde el User-Agent.
   * Ejemplos: "Chrome en Windows", "Safari en iPhone", "Firefox en macOS"
   *
   * @param {string} userAgent
   * @returns {string}
   */
  static generateDeviceName(userAgent: string | null | undefined) {
    if (!userAgent) {
      return 'Dispositivo desconocido';
    }

    // Nombres legibles para clientes HTTP nativos de Android
    // (estos UAs no tienen browser/OS parseables por ua-parser-js)
    if (/^okhttp\//i.test(userAgent)) {
      return 'App Android';
    }
    if (/^dalvik\//i.test(userAgent)) {
      return 'App Android (Dalvik)';
    }
    if (/^android-async-http\//i.test(userAgent)) {
      return 'App Android (AsyncHttp)';
    }
    if (/^volley\//i.test(userAgent)) {
      return 'App Android (Volley)';
    }
    if (/^axios\//i.test(userAgent)) {
      return 'App (axios)';
    }

    const { browser, os } = DeviceFingerprintUtil.parseUserAgent(userAgent);

    if (browser && os) {
      return `${browser} en ${os}`;
    }
    if (browser) {
      return browser;
    }
    if (os) {
      return os;
    }
    return 'Dispositivo desconocido';
  }

  /**
   * Genera hash desde el objeto req de Express.
   * Atajo para usar en middlewares.
   *
   * @param {Object} req - Express request
   * @returns {string}
   */
  static generateFromRequest(req: Request) {
    const userAgent = req.headers?.['user-agent'] || '';
    return DeviceFingerprintUtil.generateHash(userAgent);
  }

  /**
   * Parsea el User-Agent y retorna browser, os y deviceType.
   * Usa ua-parser-js para mayor precisión.
   *
   * @param {string} userAgent
   * @returns {{ browser: string|null, os: string|null, deviceType: string }}
   */
  static parseUserAgent(userAgent: string | null | undefined) {
    if (!userAgent) {
      return { browser: null, os: null, deviceType: 'desktop' };
    }

    // ── Detección de clientes HTTP nativos móviles ──────────────────────────
    // okhttp, Dalvik, Volley y similares son usados por apps Android nativas.
    // ua-parser-js no los reconoce como móvil porque no son browsers,
    // por lo que caen al fallback 'desktop'. Los detectamos antes explícitamente.
    const mobileHttpClients = /^(okhttp|dalvik|android-async-http|volley)\//i;
    if (mobileHttpClients.test(userAgent)) {
      return { browser: null, os: 'Android', deviceType: 'mobile' };
    }

    // ua-parser-js v2: llamado como función devuelve el resultado parseado directamente
    const result = UAParser(userAgent);

    const browser = result.browser?.name || null;
    const osName = result.os?.name || null;
    const deviceKind = result.device?.type || null; // 'mobile' | 'tablet' | undefined (desktop)

    let deviceType = 'desktop';
    if (deviceKind === 'mobile') {
      deviceType = 'mobile';
    } else if (deviceKind === 'tablet') {
      deviceType = 'tablet';
    }

    return { browser, os: osName, deviceType };
  }

  /**
   * Geolocaliza una IP usando geoip-lite (offline, sin API externa).
   * Retorna ciudad, país y código de país.
   * Si la IP es local o no se encuentra, retorna nulls.
   *
   * @param {string} ip
   * @returns {{ city: string|null, country: string|null, countryCode: string|null }}
   */
  static geolocateIp(ip: string | null | undefined) {
    if (!ip) {
      return { city: null, country: null, countryCode: null };
    }

    // IPs locales / loopback no tienen geo
    const isLocal =
      ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');

    if (isLocal) {
      return { city: 'Local', country: 'Local', countryCode: null };
    }

    const geo = geoip.lookup(ip);
    if (!geo) {
      return { city: null, country: null, countryCode: null };
    }

    return {
      city: geo.city || null,
      country: geo.country ? DeviceFingerprintUtil._countryName(geo.country) : null,
      countryCode: geo.country || null
    };
  }

  /**
   * Método conveniente que combina parseUserAgent + geolocateIp
   * y retorna todo lo necesario para crear/actualizar un dispositivo.
   *
   * @param {string} userAgent
   * @param {string} ip
   * @returns {{
   *   browser: string|null,
   *   os: string|null,
   *   deviceType: string,
   *   city: string|null,
   *   country: string|null,
   *   countryCode: string|null,
   *   deviceName: string
   * }}
   */
  // [RF-AUTH-03] | CA-01, CA-03 | Enriquece dispositivo con ua-parser-js
  // (browser/os/deviceType) y geoip-lite (city/country/countryCode offline)
  // Nota: la detección de "dispositivo nuevo" usa solo fingerprint (hash de
  // User-Agent), no IP. Decisión técnica consciente — ver CA-03
  static enrichDevice(userAgent: string | null | undefined, ip: string | null | undefined) {
    const { browser, os, deviceType } = DeviceFingerprintUtil.parseUserAgent(userAgent);
    const { city, country, countryCode } = DeviceFingerprintUtil.geolocateIp(ip);
    const deviceName = DeviceFingerprintUtil.generateDeviceName(userAgent);

    return { browser, os, deviceType, city, country, countryCode, deviceName };
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /**
   * Normaliza el User-Agent eliminando ruido de versiones de build
   * para que el hash sea estable entre actualizaciones menores.
   * @private
   */
  static _normalize(userAgent: string) {
    if (!userAgent) {
      return 'unknown';
    }

    return (
      userAgent
        .toLowerCase()
        .trim()
        // Eliminar versiones de build específicas (ej: Chrome/120.0.6099.129 → Chrome/120)
        .replaceAll(/(\w+)\/\d+\.\d+\.\d+\.\d+/g, '$1')
        // Eliminar espacios múltiples
        .replaceAll(/\s+/g, ' ')
    );
  }

  /**
   * Mapeo básico de código ISO a nombre de país en español.
   * Cubre los países más comunes de Latinoamérica + otros relevantes.
   * @private
   */
  static _countryName(code: string): string {
    const countries: Record<string, string> = {
      CL: 'Chile',
      AR: 'Argentina',
      PE: 'Perú',
      CO: 'Colombia',
      MX: 'México',
      BR: 'Brasil',
      UY: 'Uruguay',
      PY: 'Paraguay',
      BO: 'Bolivia',
      EC: 'Ecuador',
      VE: 'Venezuela',
      US: 'Estados Unidos',
      ES: 'España',
      GB: 'Reino Unido',
      DE: 'Alemania',
      FR: 'Francia',
      IT: 'Italia',
      CN: 'China',
      JP: 'Japón',
      KR: 'Corea del Sur',
      CA: 'Canadá',
      AU: 'Australia'
    };
    return countries[code] || code;
  }
}

export default DeviceFingerprintUtil;
