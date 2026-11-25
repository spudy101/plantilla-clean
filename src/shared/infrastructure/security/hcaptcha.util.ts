// Utilidad para verificar tokens CAPTCHA usando hCaptcha.
//
// hCaptcha es el CAPTCHA más adoptado en el sector fintech por:
//   - Cumplimiento GDPR/CCPA (no vende datos a terceros)
//   - Tier gratuito generoso
//   - API idéntica a reCAPTCHA (migración simple)
//
// Instalación:
//   npm install node-fetch   ← solo si tu Node < 18
//   (Node 18+ tiene fetch nativo — no necesitas nada)
//
// Variables de entorno requeridas:
//   HCAPTCHA_SECRET_KEY   → secret key de tu cuenta hCaptcha (nunca al frontend)
//   HCAPTCHA_SITE_KEY     → site key pública (va en el frontend)
//
// Registro gratuito: https://dashboard.hcaptcha.com/signup
// En modo TEST usa:
//   HCAPTCHA_SECRET_KEY = 0x0000000000000000000000000000000000000000
//   HCAPTCHA_SITE_KEY   = 10000000-ffff-ffff-ffff-000000000001
//   (hCaptcha acepta estos valores como siempre válidos en desarrollo)

import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import constantsModule from '../config';
const { hcaptcha } = constantsModule;
import { InvalidInputError } from '../../domain/errors/domain-error';
import { isExpectedError, ServiceUnavailableError } from '../../application/errors';
import errorMessageModule from '../../kernel/error-message.util';

const { errorMessage } = errorMessageModule;

/** Respuesta de https://hcaptcha.com/siteverify (campos usados). */
interface HCaptchaVerifyResponse {
  success: boolean;
  hostname?: string;
  'error-codes'?: string[];
}

// === RF-LP-04: Formulario de Contacto, Canales de Atención y Gestión de Inquietudes Públicas ===

const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

class HCaptchaUtil {
  /**
   * Verifica un token CAPTCHA contra la API de hCaptcha.
   *
   * Siempre llamar en BACKEND — nunca confíes en la validación del frontend.
   *
   * @param {string} token   - Token enviado por el frontend (campo captchaToken)
   * @param {string} [ip]    - IP del usuario (opcional, mejora la detección de fraude)
   * @returns {Promise<boolean>}  true si el token es válido
   *
   * @example
   * const ok = await HCaptchaUtil.verify(req.body.captchaToken, req.ip);
   * (si no es válido lanza InvalidInputError: la presentación responde 400)
   */
  static async verify(token: string | null | undefined, ip: string | null = null): Promise<true> {
    const { secretKey } = hcaptcha;

    // [RF-LP-04] | CA-04 | Fail-closed: sin clave configurada no se permite el envío (503)
    if (!secretKey) {
      logger.warn('[HCaptcha] HCAPTCHA_SECRET_KEY no configurada — no se puede verificar el CAPTCHA');
      // Reintentar no lo arregla hasta que se configure la clave: no es temporal para el cliente
      throw new ServiceUnavailableError('Verificación CAPTCHA no disponible: falta configuración del servidor (HCAPTCHA_SECRET_KEY)', {
        retryable: false
      });
    }

    if (!token) {
      logger.info('[HCaptcha] Token vacío recibido');
      throw new InvalidInputError('Verificación CAPTCHA fallida: token no proporcionado', 'BAD_REQUEST');
    }

    let data: HCaptchaVerifyResponse;
    try {
      const fields: Record<string, string> = { secret: secretKey, response: token };
      if (ip) {
        fields.remoteip = ip;
      }
      const params = new URLSearchParams(fields);

      const response = await fetch(HCAPTCHA_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) {
        logger.warn('[HCaptcha] Error HTTP de la API', { status: response.status });
        throw new ServiceUnavailableError('No se pudo verificar el CAPTCHA con el proveedor');
      }

      data = (await response.json()) as HCaptchaVerifyResponse;
    } catch (error) {
      // [RF-LP-04] | CA-04 | Fail-closed: ante fallo de red o API no se permite el envío (503).
      // Si el error ya viene tipado (ej. response.ok=false), se re-lanza; cualquier otro fallo (timeout, red
      // caída, JSON inválido) se traduce a no disponible.
      if (isExpectedError(error)) {
        throw error;
      }
      logger.warn('[HCaptcha] Error al verificar token — fail-closed', { error: errorMessage(error) });
      throw new ServiceUnavailableError('No se pudo verificar el CAPTCHA. Intente de nuevo.');
    }

    // [RF-LP-04] | CA-04 | Token inválido según hCaptcha (400)
    if (!data.success) {
      logger.warn('[HCaptcha] Token inválido', {
        errorCodes: data['error-codes'] || []
      });
      throw new InvalidInputError('Verificación CAPTCHA fallida. Por favor intente de nuevo.', 'BAD_REQUEST');
    }

    logger.debug('[HCaptcha] Token verificado correctamente', {
      hostname: data.hostname || null
    });

    return true;
  }
}

export default HCaptchaUtil;
