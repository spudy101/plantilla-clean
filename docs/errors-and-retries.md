# Errores y reintentos

Cómo distingue un consumidor de la API un error **temporal** (reintentar puede funcionar) de uno
**permanente** (repetir da lo mismo), y qué hace el servidor por su cuenta antes de responder.

## El contrato

Toda respuesta de error tiene esta forma:

```json
{
  "success": false,
  "statusCode": 503,
  "message": "La base de datos no está disponible en este momento. Intentá de nuevo en unos segundos",
  "errorCode": "DATABASE_UNAVAILABLE",
  "details": { "correlationId": "c1a3…" },
  "retryable": true,
  "timestamp": "2026-11-19T05:26:21.490Z"
}
```

| Campo | Qué es |
|---|---|
| `errorCode` | Qué pasó, para que el código del cliente decida (el `message` es para personas). |
| `retryable` | **`true`**: temporal, reintentar la **misma** petición puede funcionar. **`false`**: permanente, hay que cambiar algo (datos, permisos, código). |
| header `Retry-After` | Segundos a esperar antes de reintentar, cuando el servidor lo sabe. |
| `errors` | Solo en errores de validación: un **array**, un ítem por campo (`field`, `message`, `hint`). |
| `details` | **Objeto** con contexto: `correlationId` (para buscar la operación en los logs), `code` en los 401. |

Por defecto `retryable` sale del status (`shared/http/retryable.ts`): **408, 429, 502, 503, 504** son
temporales; el resto, permanentes. Un error puede declararlo distinto: un 409 `REQUEST_IN_PROGRESS` es
temporal; un 503 por configuración faltante no lo es.

CORS expone `Retry-After`, `RateLimit-*` e `Idempotent-Replayed`: sin eso el navegador los oculta.

## Errores temporales

| Status | `errorCode` | Cuándo | `Retry-After` |
|---|---|---|---|
| 409 | `REQUEST_IN_PROGRESS` | La misma petición todavía se está procesando (lock de petición duplicada, o clave de idempotencia en curso). | lo que dura el lock / 2 s |
| 409 | `TRANSACTION_CONFLICT` | La operación chocó con otra sobre los mismos datos y siguió chocando después de repetirla. | 1 s |
| 429 | `RATE_LIMIT` | Se superó un límite (por IP, por sesión, de códigos OTP, bloqueo de cuenta). | lo que falta para que se libere |
| 503 | `DATABASE_UNAVAILABLE` | La base no responde, se cortó la conexión, no hay conexiones libres o venció un timeout. | 5 s |
| 503 | `CIRCUIT_OPEN` | Un proveedor externo (SES, S3, SNS) está caído y su circuito está abierto. | lo que falta para la próxima prueba |
| 503 | `SERVICE_UNAVAILABLE` | Un proveedor no respondió (p. ej. el CAPTCHA). | — |

## Errores permanentes

| Status | `errorCode` | Qué hacer |
|---|---|---|
| 400 | `BAD_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` | Corregir la petición. |
| 401 | `UNAUTHORIZED` + `details.code` | Solo `TOKEN_EXPIRED` se resuelve renovando; el resto pide login (ver docs/auth-sessions.md). |
| 403 | `FORBIDDEN` | Falta permiso. |
| 404 | `NOT_FOUND` | No existe. |
| 409 | `CONFLICT` | El estado no lo permite (ya existe, ya se resolvió). |
| 422 | `VALIDATION_ERROR` (+ `errors[]`), `IDEMPOTENCY_KEY_REUSED` | Corregir los datos / usar otra clave. |
| 500 | `INTERNAL_ERROR`, `DATABASE_ERROR` | Bug: reintentar no lo arregla. Reportar con el `correlationId`. |

## Cómo reintentar (cliente)

1. Reintentar **solo** si `retryable: true` (o no hubo respuesta: error de red, timeout).
2. Esperar `Retry-After` si viene. Si no, **backoff exponencial con jitter**: ~1 s, 2 s, 4 s + un aleatorio,
   para que muchos clientes no reintenten en el mismo instante.
3. Máximo 2 o 3 intentos. Después, mostrar el error al usuario.
4. Una petición que **crea o envía algo** (POST) se reintenta solo si es idempotente: con la misma
   `Idempotency-Key` (ver docs/idempotency.md). Sin clave, un reintento después de un timeout puede
   ejecutarla dos veces. GET, PUT y DELETE se pueden reintentar.

## Lo que el servidor hace antes de responder

- **Conflictos de transacción.** Si Postgres aborta una transacción por deadlock o serialización,
  `unitOfWork.run()` la repite **completa** (hasta 3 intentos, backoff corto y aleatorio). Es seguro porque
  el rollback deshizo todo lo de la base. Lo que no se deshace es lo externo: si la unidad llamó a un
  proveedor (email, SMS, S3) **no se repite** y sale `409 TRANSACTION_CONFLICT`. Regla: lo externo va
  después del commit, fuera de `run()`.
- **Base no disponible.** `shared/database/database-errors.ts` reconoce lo que no es culpa de la petición
  (códigos de Prisma, SQLSTATE de Postgres, errores de red de Node, timeout del pool) y se responde 503.
  El pool espera una conexión libre como mucho 5 s (`connectionTimeoutMillis`; antes esperaba para siempre).
- **Proveedores externos.** `callProvider` reintenta los errores transitorios del proveedor y lo protege
  con un circuit breaker (ver docs/ARCHITECTURE.md, "Llamadas a proveedores externos").

## Al escribir código

- **Un error temporal se declara**: `AppError.serviceUnavailable(msg, details, retryAfter)`,
  `AppError.tooManyRequests(msg, details, retryAfter)`, `AppError.requestInProgress(msg, retryAfter)`. Si un
  503 no es temporal para el cliente (p. ej. falta configuración), `err.retryable = false`.
- **Un `catch` no envuelve en 500 lo que ya tiene respuesta**: `if (shouldPropagate(error)) throw error;`
  (`shared/http/error-propagation.ts`) deja pasar cualquier `AppError` y los errores temporales de la base.
  El helper anterior (`isOperationalError`) solo dejaba pasar los AppError 5xx: un 404 lanzado adentro del
  `try` salía como 500.
- **Cuando falla una llamada a un proveedor**: `throw providerFailure(error, 'Error al subir el documento')`
  (`shared/infra/provider-errors.ts`) responde 503 temporal si el proveedor estaba mal y 500 si no.

Todo esto está probado contra Postgres real en `tests/integration/database-errors.test.ts` (base
inalcanzable, pool agotado, deadlock resuelto por el Unit of Work) y por HTTP en
`tests/unit/http/error-contract.test.ts`.
