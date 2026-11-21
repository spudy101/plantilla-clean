import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * Ejecuta una función async con reintentos automáticos y backoff exponencial.
 *
 * El backoff sigue la fórmula: baseDelayMs * 2^(intento-1)
 *   intento 1 → fallo → espera 1s → intento 2
 *   intento 2 → fallo → espera 2s → intento 3
 *   intento 3 → fallo → propaga el error al caller
 *
 * Solo reintenta cuando la función lanza una excepción.
 * Si la función retorna exitosamente (aunque sea con un error de negocio),
 * el resultado se retorna tal cual sin reintentar.
 *
 * @param {Function} fn - Función async a ejecutar
 * @param {Object}   opts
 * @param {number}   opts.maxRetries   - Número máximo de intentos (default: 3)
 * @param {number}   opts.baseDelayMs  - Delay base en ms para backoff (default: 1000)
 * @param {string}   opts.label        - Etiqueta para logging (default: '')
 * @returns {Promise<any>} Resultado de fn si algún intento tiene éxito
 * @throws {Error} El error del último intento si todos fallan
 */
interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
  /** Si devuelve false, el error se propaga sin reintentar (p. ej. un error del cliente, no del proveedor). */
  shouldRetry?: (error: unknown) => boolean;
}

import errorMessageModule from '../utils/error-message.util';

const { errorMessage } = errorMessageModule;

async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = DEFAULT_MAX_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS, label = '', shouldRetry = () => true }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!shouldRetry(err)) {
        throw err;
      }
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        logger.warn(`[RetryUtil] ${label} — intento ${attempt}/${maxRetries} fallido, reintentando en ${delayMs}ms`, {
          error: errorMessage(err)
        });
        await new Promise(resolve => {
          setTimeout(resolve, delayMs);
        });
      } else {
        logger.warn(`[RetryUtil] ${label} — todos los ${maxRetries} intentos fallaron`, {
          error: errorMessage(err)
        });
      }
    }
  }

  throw lastError;
}

export default { withRetry };
