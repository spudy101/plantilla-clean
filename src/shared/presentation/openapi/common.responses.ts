/**
 * ============================================================
 * COMMON RESPONSES
 * ============================================================
 * Derivado de:
 *   - ApiResponse  (app-response.util.js)
 *   - AppError     (app-error.util.js)
 *
 * Estructura éxito:
 *   { success, statusCode, message, data, metadata, timestamp }
 *
 * Estructura error:
 *   { success, statusCode, message, errorCode?, errors?, details?, retryable, timestamp }
 *   errors = array por campo (validación) · details = objeto de contexto · retryable = ¿es temporal?
 *   Los errores temporales con espera conocida traen además el header Retry-After (segundos).
 *
 * Uso en paths:
 *   responses: {
 *     200: commonResponses.ok({ $ref: '#/components/schemas/User' }),
 *     ...commonResponses.BadRequest,
 *     ...commonResponses.NotFound,
 *   }
 *
 * IMPORTANTE: los errores exportan { [statusCode]: { description, content } }
 * para que el spread funcione correctamente en los paths.
 */

import { isRetryableStatus } from '../http/retryable';

// ─── Helpers privados ─────────────────────────────────────────

/** Fragmento de schema OpenAPI (forma libre: es documentación). */
type Schema = Record<string, unknown>;

const _errorBody = (statusCode: number, errorCode: string) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    statusCode: { type: 'integer', example: statusCode },
    message: { type: 'string' },
    errorCode: { type: 'string', example: errorCode },
    details: {
      type: 'object',
      nullable: true,
      description: 'Contexto adicional del error. En los 401/403 de autenticación incluye `code` (ver descripción).',
      properties: { code: { type: 'string' }, correlationId: { type: 'string' } }
    },
    retryable: {
      type: 'boolean',
      example: isRetryableStatus(statusCode),
      description:
        '`true`: temporal, reintentar la misma petición puede funcionar (esperar `Retry-After` si viene, si no backoff exponencial con jitter). `false`: permanente, repetirla da lo mismo.'
    },
    timestamp: { type: 'string', format: 'date-time' }
  }
});

const RETRY_AFTER_HEADER = {
  'Retry-After': { description: 'Segundos a esperar antes de reintentar.', schema: { type: 'integer', example: 30 } }
};

const _errorResponse = (description: string, statusCode: number, errorCode: string, { retryAfter = false } = {}) => ({
  // La key numérica permite usar ...commonResponses.BadRequest directamente en responses
  [statusCode]: {
    description,
    ...(retryAfter ? { headers: RETRY_AFTER_HEADER } : {}),
    content: {
      'application/json': {
        schema: _errorBody(statusCode, errorCode)
      }
    }
  }
});

// ─── Errores fijos (usar con spread: ...commonResponses.X) ────

/** 400 — AppError.badRequest() */
const BadRequest = _errorResponse('Parámetros incorrectos o faltantes.', 400, 'BAD_REQUEST');

/**
 * 401 — AppError.unauthorized()
 *
 * El motivo concreto viaja en `details.code` (`AUTH_ERROR_CODES`), porque `errorCode` siempre es
 * `UNAUTHORIZED` y no alcanza para decidir qué hacer. Es el contrato con el cliente: solo
 * `TOKEN_EXPIRED` se resuelve renovando; el resto obliga a un nuevo login.
 */
const Unauthorized = _errorResponse(
  'No autenticado. El motivo específico viene en `details.code`:\n\n' +
    '- `TOKEN_EXPIRED` — el access token venció. **Único caso recuperable:** renovar en `/auth/refresh` y reintentar.\n' +
    '- `TOKEN_INVALID` — firma inválida o token malformado.\n' +
    '- `SESSION_CLOSED` — la sesión fue cerrada (logout, revocación del administrador, cierre desde otro dispositivo).\n' +
    '- `SESSION_INACTIVITY` — 15 minutos sin actividad.\n' +
    '- `SESSION_ABSOLUTE_LIFETIME` — la sesión alcanzó su tope de 8 horas.\n' +
    '- `SESSION_COMPROMISED` — se detectó reutilización del refresh token; todas las sesiones fueron cerradas.\n' +
    '- `REFRESH_TOKEN_INVALID` — refresh token ausente, vencido o revocado.\n\n' +
    'Salvo `TOKEN_EXPIRED`, todos exigen volver a iniciar sesión.',
  401,
  'UNAUTHORIZED'
);

/** 403 — AppError.forbidden() */
const Forbidden = _errorResponse('Autenticado pero sin permiso para este recurso.', 403, 'FORBIDDEN');

/** 404 — AppError.notFound() */
const NotFound = _errorResponse('El recurso solicitado no fue encontrado.', 404, 'NOT_FOUND');

/** 409 — AppError.conflict() */
const Conflict = _errorResponse('Conflicto de estado. El recurso ya existe o viola una restricción.', 409, 'CONFLICT');

/** 409 temporal — AppError.requestInProgress(): la misma petición todavía se está procesando. */
const RequestInProgress = _errorResponse(
  'La misma petición todavía se está procesando (petición duplicada o clave de idempotencia en curso). Temporal: `retryable: true`; reintentar después de `Retry-After`.',
  409,
  'REQUEST_IN_PROGRESS',
  { retryAfter: true }
);

/**
 * 422 — ApiResponse.validationError() — incluye array de errores por campo.
 * [RF-LP-03][CA-05]: cada ítem incluye `hint` (sugerencia de corrección
 * para el usuario); es null cuando el validador no provee sugerencia.
 */
const ValidationError = {
  422: {
    description: 'Error de validación en los campos enviados.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            statusCode: { type: 'integer', example: 422 },
            message: { type: 'string', example: 'Error de validación' },
            errorCode: { type: 'string', example: 'VALIDATION_ERROR' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', example: 'email' },
                  message: { type: 'string', example: 'El email es requerido' },
                  hint: {
                    type: 'string',
                    nullable: true,
                    example: 'Ingresá un correo válido, por ejemplo usuario@dominio.com'
                  },
                  value: {}
                }
              }
            },
            timestamp: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  }
};

/** 429 — AppError.tooManyRequests() */
const RateLimitExceeded = _errorResponse(
  'Demasiadas peticiones. Rate limit excedido. Temporal: reintentar después de `Retry-After` (también vienen los headers `RateLimit-*`).',
  429,
  'RATE_LIMIT',
  { retryAfter: true }
);

/** 500 — AppError.internal() */
const InternalServerError = _errorResponse('Error interno del servidor.', 500, 'INTERNAL_ERROR');

/** 503 — AppError.serviceUnavailable() */
const ServiceUnavailable = _errorResponse(
  'Algo de lo que dependemos no está disponible ahora. `errorCode`: `SERVICE_UNAVAILABLE`, `DATABASE_UNAVAILABLE` (base de datos) o `CIRCUIT_OPEN` (proveedor externo caído). Temporal: reintentar después de `Retry-After`.',
  503,
  'SERVICE_UNAVAILABLE',
  { retryAfter: true }
);

// ─── Idempotencia (shared/http/idempotency, docs/idempotency.md) ──

/** Parámetro del header para las operaciones con `idempotent()`: `parameters: [commonResponses.IdempotencyKeyHeader]`. */
const IdempotencyKeyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description:
    'Clave única de **esta** operación (se recomienda un UUID v4). Generala una vez y repetila tal cual en cada reintento de la misma operación; una operación distinta necesita otra clave. Se recuerda 24 h.',
  schema: { type: 'string', maxLength: 255, example: '7f3c1a2e-9b4d-4c8e-a1f0-2d6b5e8c9a10' }
};

/** Párrafo para la descripción de una operación idempotente (las respuestas se documentan aparte). */
const IDEMPOTENCY_DESCRIPTION = [
  '**Idempotente** (header `Idempotency-Key`, obligatorio): si se cortó la respuesta, reintentá con **la misma clave** y el mismo body; la operación no se ejecuta dos veces.',
  '- Primera vez: se ejecuta y se guarda la respuesta.',
  '- Reintento cuando ya terminó: misma respuesta (status y body), con el header `Idempotent-Replayed: true`.',
  '- Reintento mientras la primera sigue en curso: `409 REQUEST_IN_PROGRESS`, temporal; esperar `Retry-After`.',
  '- Misma clave con otro body: `422 IDEMPOTENCY_KEY_REUSED` (permanente: usá otra clave).',
  '- Sin la clave o con formato inválido: `400 IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`.',
  '- Un error temporal (`retryable: true`, p. ej. 503) no se guarda: el reintento con la misma clave se ejecuta de nuevo.'
].join('\n');

// ─── Helpers para respuestas de éxito ─────────────────────────

/**
 * 200 — ApiResponse.success()
 * @param {object} dataSchema  Schema del campo `data` — p.ej. { $ref: '...' }
 * @param {string} [description]
 */
const ok = (dataSchema: Schema | null, description = 'Operación exitosa.') => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          statusCode: { type: 'integer', example: 200 },
          message: { type: 'string' },
          data: dataSchema,
          metadata: { nullable: true, type: 'object' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
});

/**
 * 200 paginado — ApiResponse.success() con metadata completa
 * @param {object} itemSchema  Schema de cada item del array — p.ej. { $ref: '...' }
 * @param {string} [description]
 */
const paginated = (itemSchema: Schema, description = 'Lista obtenida exitosamente.') => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          statusCode: { type: 'integer', example: 200 },
          message: { type: 'string' },
          data: {
            type: 'array',
            items: itemSchema
          },
          metadata: { $ref: '#/components/schemas/Metadata' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
});

/**
 * 201 — ApiResponse.created()
 * @param {object} dataSchema
 * @param {string} [description]
 */
const created = (dataSchema: Schema, description = 'Recurso creado exitosamente.') => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          statusCode: { type: 'integer', example: 201 },
          message: { type: 'string' },
          data: dataSchema,
          timestamp: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
});

/**
 * 202 — ApiResponse.accepted()
 * Operación aceptada, desenlace todavía no disponible. Dos usos: pendiente de segunda aprobación
 * (framework de doble aprobación) o trabajo encolado que corre en segundo plano (retry de
 * integraciones). El tercer parámetro ajusta el ejemplo de `message` según el caso.
 * @param {object} dataSchema  Schema del `data` (ApprovalRequest, o el recurso encolado)
 * @param {string} [description]
 * @param {string} [messageExample]
 */
const accepted = (
  dataSchema: Schema,
  description = 'Operación aceptada — pendiente de segunda aprobación.',
  messageExample = 'Operación pendiente de segunda aprobación'
) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          statusCode: { type: 'integer', example: 202 },
          message: { type: 'string', example: messageExample },
          data: dataSchema,
          metadata: { nullable: true, type: 'object' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
});

/** 204 — ApiResponse.noContent() */
const noContent = {
  204: {
    description: 'Operación exitosa. Sin contenido.'
  }
};

// ─── Exports ──────────────────────────────────────────────────

export default {
  // Errores (usar con spread: ...commonResponses.BadRequest)
  BadRequest,
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  RequestInProgress,
  IdempotencyKeyHeader,
  IDEMPOTENCY_DESCRIPTION,
  ValidationError,
  RateLimitExceeded,
  InternalServerError,
  ServiceUnavailable,

  // Éxitos (helpers — llamar como función)
  ok,
  paginated,
  created,
  accepted,
  noContent
};
