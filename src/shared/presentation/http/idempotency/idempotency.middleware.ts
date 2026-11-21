// Idempotencia: que una petición con efectos (crear, enviar, cobrar) se ejecute UNA sola vez aunque el
// cliente la mande varias, típicamente porque se cortó la respuesta y reintentó. Guía: docs/idempotency.md.
//
// El cliente manda una clave única por operación (`Idempotency-Key: <uuid>`) y la repite tal cual en cada
// reintento. El servidor guarda, por clave, qué pasó con la primera petición:
//
//   primera vez               → la reclama (INSERT atómico), la ejecuta y guarda status + body
//   reintento, ya terminó     → devuelve la respuesta guardada, sin ejecutar (header Idempotent-Replayed)
//   reintento, sigue en curso → 409 REQUEST_IN_PROGRESS temporal, con Retry-After
//   misma clave, otro body    → 422 IDEMPOTENCY_KEY_REUSED (error del cliente: una clave = una operación)
//   la dueña no terminó       → si su plazo (lease) venció, la retoma y la ejecuta de nuevo
//
// Qué se guarda: el resultado definitivo, éxito o error permanente (un 422 se repite igual). Un error
// temporal (`retryable: true`: 503, 429, conflicto de transacción) NO se guarda: libera la clave para que
// el reintento se ejecute de verdad.
//
// Uso — después de autenticar y validar (un body inválido no gasta la clave):
//   router.post('/notifications', AuthMiddleware.externalAuthenticate, validate({ body }), idempotent(), Controller.create);
//
// Con idempotent() la ruta no necesita RequestLockMiddleware: la clave ya resuelve las peticiones
// simultáneas (la segunda recibe 409 temporal) y además los reintentos posteriores.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import AppError from '../app-error.util';
import idempotencyRepository from '../../../infrastructure/database/idempotency.repository';
import loggerUtilModule from '../../../infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import errorMessageModule from '../../../kernel/error-message.util';
const { errorMessage } = errorMessageModule;

const HEADER = 'Idempotency-Key';
const REPLAYED_HEADER = 'Idempotent-Replayed';
// Imprimibles ASCII sin espacios; se recomienda un UUID v4
const KEY_FORMAT = /^[\x21-\x7E]{1,255}$/;

const MS_PER_HOUR = 3_600_000;
/** Cuánto se recuerda una clave: un reintento después de esto se trata como petición nueva. */
const KEY_TTL_MS = 24 * MS_PER_HOUR;
/**
 * Plazo de la petición dueña. Tiene que superar lo que puede tardar el handler más lento (un envío con
 * reintentos al proveedor anda en el minuto): si vence antes, otra petición la retomaría estando viva.
 */
const LEASE_MS = 2 * 60_000;
/** Retry-After del 409 en curso: la dueña suele terminar en segundos. */
const IN_PROGRESS_RETRY_AFTER_S = 2;

/**
 * Quién llama: las claves son de cada cliente, nunca compartidas. Usuario autenticado o sistema externo
 * (X-API-Key, guardada como hash: nunca en claro). Sin ninguno, la ruta está mal armada.
 */
function scopeOf(req: Request): string {
  if (req.user?.userId) {
    return `user:${req.user.userId}`;
  }
  const apiKey = req.header('X-API-Key');
  if (apiKey) {
    return `api:${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 32)}`;
  }
  throw AppError.internal('idempotent() necesita una ruta autenticada (usuario o X-API-Key)');
}

/** JSON con las claves ordenadas: el mismo body con otro orden de campos es la misma petición. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Huella de la petición: método + ruta + body (ya validado). */
function fingerprint(req: Request): string {
  return crypto
    .createHash('sha256')
    .update(`${req.method} ${req.baseUrl}${req.path}\n${stableStringify(req.body)}`)
    .digest('hex');
}

/** Un error temporal no se guarda: el cliente lo reintentará y tiene que ejecutarse de nuevo. */
function isTemporaryError(body: unknown): boolean {
  return Boolean(
    body &&
    typeof body === 'object' &&
    (body as { success?: unknown }).success === false &&
    (body as { retryable?: unknown }).retryable === true
  );
}

const keyError = (message: string, code: string) => new AppError(message, 400, code, null, false);

/**
 * Captura la respuesta de la petición dueña de la clave y la guarda ANTES de enviarla: si el cliente la
 * recibe, ya quedó guardada, y un reintento suyo nunca re-ejecuta. Si guardar falla, se envía igual.
 */
function captureResponse(res: Response, scope: string, key: string) {
  const send = res.json.bind(res);
  let captured = false;
  // Respaldo: una respuesta sin body (204) no pasa por res.json; se guarda el status al terminar
  res.on('finish', () => {
    if (!captured) {
      captured = true;
      idempotencyRepository
        .complete(scope, key, res.statusCode, null)
        .catch((error: unknown) =>
          logger.error('[Idempotency] No se pudo guardar el resultado de la clave', { scope, key, error: errorMessage(error) })
        );
    }
  });
  res.json = (body: unknown) => {
    res.json = send; // una sola vez
    captured = true;
    const persist = isTemporaryError(body)
      ? idempotencyRepository.release(scope, key)
      : idempotencyRepository.complete(scope, key, res.statusCode, body);
    persist
      .catch((error: unknown) =>
        logger.error('[Idempotency] No se pudo guardar el resultado de la clave', { scope, key, error: errorMessage(error) })
      )
      .finally(() => send(body));
    return res;
  };
}

/** Middleware de idempotencia. La clave es obligatoria en las rutas que lo usan. */
function idempotent() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.header(HEADER);
      if (!key) {
        return next(
          keyError(
            `Falta el header ${HEADER}: generá un UUID por operación y repetilo en cada reintento`,
            'IDEMPOTENCY_KEY_REQUIRED'
          )
        );
      }
      if (!KEY_FORMAT.test(key)) {
        return next(
          keyError(
            `${HEADER} inválido: hasta 255 caracteres imprimibles, sin espacios (se recomienda un UUID)`,
            'IDEMPOTENCY_KEY_INVALID'
          )
        );
      }

      const scope = scopeOf(req);
      const requestHash = fingerprint(req);
      const now = Date.now();
      const lease = () => new Date(Date.now() + LEASE_MS);

      // 1. Reclamarla. Si estaba vencida (más vieja que el TTL), se borra y se reclama de nuevo.
      let owner = await idempotencyRepository.claim({
        scope,
        key,
        requestHash,
        lockedUntil: lease(),
        expiresAt: new Date(now + KEY_TTL_MS)
      });
      let existing = owner ? null : await idempotencyRepository.find(scope, key);
      if (existing && existing.expiresAt.getTime() < now) {
        await idempotencyRepository.deleteIfExpired(scope, key);
        owner = await idempotencyRepository.claim({
          scope,
          key,
          requestHash,
          lockedUntil: lease(),
          expiresAt: new Date(now + KEY_TTL_MS)
        });
        existing = owner ? null : await idempotencyRepository.find(scope, key);
      }

      if (!owner) {
        if (!existing) {
          // Se liberó entre el claim y el find (resultado temporal de la dueña): que reintente
          return next(
            AppError.requestInProgress('La operación con esta clave está terminando. Reintentá', IN_PROGRESS_RETRY_AFTER_S)
          );
        }
        // 2. La misma clave tiene que ser la misma petición
        if (existing.requestHash !== requestHash) {
          return next(
            new AppError(
              `Esta ${HEADER} ya se usó con otra petición. Cada operación distinta necesita su propia clave`,
              422,
              'IDEMPOTENCY_KEY_REUSED',
              null,
              false
            )
          );
        }
        // 3. Ya terminó: se devuelve lo mismo que recibió la primera, sin ejecutar
        if (existing.status === 'completed' && existing.responseStatus !== null) {
          res.set(REPLAYED_HEADER, 'true').status(existing.responseStatus);
          return existing.responseBody === null ? res.end() : res.json(existing.responseBody);
        }
        // 4. Sigue en curso. Si el plazo de la dueña venció, no va a terminar: se retoma.
        const leaseExpired = existing.lockedUntil !== null && existing.lockedUntil.getTime() < Date.now();
        if (!leaseExpired || !(await idempotencyRepository.takeOver(scope, key, lease()))) {
          return next(AppError.requestInProgress('Ya se está procesando una petición con esta clave', IN_PROGRESS_RETRY_AFTER_S));
        }
        logger.warn('[Idempotency] Clave retomada: la petición anterior no terminó', { scope, key });
      }

      // Dueña de la clave: se ejecuta y se guarda el resultado
      captureResponse(res, scope, key);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export { idempotent, HEADER as IDEMPOTENCY_HEADER };
export default { idempotent, IDEMPOTENCY_HEADER: HEADER };
