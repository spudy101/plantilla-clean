// TOTP propio (RFC 6238) — reemplazo del MFA que antes delegábamos en Cognito.
//
// Envuelve otplib (`authenticator`): secreto base32 compatible con Google
// Authenticator / Authy / 1Password, HMAC-SHA1, 6 dígitos, período de 30s.
//
// Este módulo es cripto puro: NO toca BD ni cifrado en reposo. El secreto se
// guarda cifrado (EncryptionUtil) en users.totp_secret; el service descifra y
// pasa el secreto en claro a verify().
//
// Ventana de tolerancia (drift): ±1 período (30s antes/después) para absorber
// desfase de reloj entre el dispositivo del usuario y el servidor.

import { authenticator } from 'otplib';
import constantsModule from '../config';
const { SECURITY, MOCKS } = constantsModule;

// ±1 step ⇒ acepta el código del período actual, el anterior y el siguiente.
authenticator.options = { window: 1 };

// Código fijo aceptado en modo mock (paridad con el OTP de SMS: MFAService._generateOtpCode).
const MOCK_TOTP_CODE = '123456';

class TotpUtil {
  /**
   * Genera un secreto TOTP nuevo en base32.
   * @returns {string} secreto base32 (en claro — el caller lo cifra antes de persistir)
   */
  static generateSecret(): string {
    return authenticator.generateSecret();
  }

  /**
   * Construye la URL `otpauth://` que el frontend renderiza como QR.
   *
   * @param {string} accountName - etiqueta visible en la app (username / email)
   * @param {string} secret      - secreto base32 en claro
   * @returns {string} otpauth://totp/{issuer}:{accountName}?secret=...&issuer=...
   */
  static keyuri(accountName: string, secret: string): string {
    return authenticator.keyuri(accountName, SECURITY.TOTP_ISSUER, secret);
  }

  /**
   * Verifica un código TOTP contra el secreto en claro.
   *
   * En modo mock (MOCK_EXTERNAL_PROVIDERS) acepta el código fijo 123456 para
   * mantener la paridad con el resto de proveedores simulados en dev/test.
   *
   * @param {string} token  - código de 6 dígitos ingresado por el usuario
   * @param {string} secret - secreto base32 en claro
   * @returns {boolean}
   */
  static verify(token: string | number | null | undefined, secret: string | null | undefined): boolean {
    if (MOCKS.EXTERNAL_PROVIDERS && token === MOCK_TOTP_CODE) {
      return true;
    }
    if (!token || !secret) {
      return false;
    }
    try {
      // authenticator.check es timing-safe internamente y no lanza ante inputs válidos.
      return authenticator.check(String(token), secret);
    } catch {
      return false;
    }
  }
}

export default TotpUtil;
