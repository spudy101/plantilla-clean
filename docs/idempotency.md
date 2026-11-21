# Idempotencia

Guía de la implementación del proyecto, pensada también para estudiar el patrón. Código:
`src/shared/presentation/http/idempotency/` (middleware + repositorio), tabla `idempotency_keys`.

## El problema

Un cliente manda `POST /notifications`. El servidor crea la notificación y la envía, pero la respuesta se
pierde en el camino (timeout, se cortó la red, se reinició un balanceador). El cliente **no sabe** si la
operación se hizo, así que reintenta, y la notificación sale **dos veces**.

No se puede resolver solo del lado del cliente ("no reintentes") ni solo del lado del servidor ("no aceptes
peticiones iguales": dos notificaciones idénticas pueden ser legítimas). Hace falta que el cliente diga
**"esta es la misma operación que antes"**. Para eso está la clave de idempotencia.

## El contrato

El cliente genera una clave única por operación, típicamente un UUID v4, la manda en el header
`Idempotency-Key` y la **repite tal cual** en cada reintento de esa operación.

| Situación | Respuesta |
|---|---|
| Primera vez con la clave | Se ejecuta. Se guarda status + body. |
| Reintento, ya terminó | La **misma respuesta** (status y body), sin ejecutar. Header `Idempotent-Replayed: true`. |
| Reintento, sigue en curso | `409 REQUEST_IN_PROGRESS`, temporal, `Retry-After: 2`. |
| Misma clave, **otro** body | `422 IDEMPOTENCY_KEY_REUSED`, permanente. Una clave = una operación. |
| Sin clave / formato inválido | `400 IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`. |
| La primera no terminó (proceso caído) | Pasado su plazo (2 min), la retoma otra petición y se ejecuta. |

Una clave se recuerda **24 h**. Después se trata como nueva, y una purga diaria borra las vencidas.

## Cómo funciona

```
petición con Idempotency-Key
  │
  ├─ INSERT (scope, clave, huella, in_progress, plazo)   ← atómico contra la PK
  │     ├─ insertó → soy la dueña ──► ejecutar ──► guardar resultado ──► responder
  │     └─ ya existía → leer la fila
  │            ├─ otra huella            → 422 IDEMPOTENCY_KEY_REUSED
  │            ├─ completed              → devolver la respuesta guardada
  │            ├─ in_progress, en plazo  → 409 REQUEST_IN_PROGRESS
  │            └─ in_progress, vencida   → retomarla (UPDATE atómico) ──► ejecutar
```

Las piezas, y por qué están:

- **El reclamo es un `INSERT` contra la clave primaria `(scope, clave)`.** No es "leer y después
  escribir": eso tiene una carrera, porque dos peticiones leen "no existe" y las dos ejecutan. Con el
  INSERT, la base garantiza que gane una sola. Es lo que prueba la ráfaga de 10 peticiones simultáneas en
  `tests/integration/idempotency.test.ts`: exactamente una ejecución.
- **`scope`: las claves son de cada cliente.** Usuario autenticado (`user:<id>`) o sistema externo
  (`api:<hash de su X-API-Key>`; la clave nunca se guarda en claro). Así dos clientes que por casualidad
  usan la misma clave no se pisan, y nadie puede leer la respuesta guardada de otro.
- **Huella (`request_hash`).** SHA-256 de método + ruta + body con las claves ordenadas (el mismo JSON en
  otro orden es la misma petición). Detecta el error del cliente de reusar una clave para otra operación,
  en vez de devolverle en silencio una respuesta que no corresponde.
- **Se guarda la respuesta antes de enviarla.** Si el cliente recibió la respuesta, ya está guardada: un
  reintento suyo nunca re-ejecuta. Si falla el guardado, se envía igual y se loguea.
- **Qué se guarda.** El resultado definitivo: un éxito, o un error permanente (un 404 se repite igual).
  Un error **temporal** (`retryable: true`: 503, 429, conflicto de transacción) **libera** la clave: el
  cliente lo va a reintentar y tiene que ejecutarse de verdad.
- **Plazo (lease) y recuperación.** Mientras se ejecuta, la fila tiene `locked_until` (2 min, más que el
  handler más lento). Si el proceso se cae a mitad, nadie la completa. Cuando vence, la próxima petición
  con la clave la retoma con un `UPDATE … WHERE locked_until < now()`, también atómico.
- **La fila vive fuera de la transacción de negocio.** El repositorio usa el cliente independiente: si la
  operación se revierte, la clave igual tiene que reflejar qué pasó.
- **Validar antes de reclamar.** El middleware va después de `validate()`: un body inválido no gasta la
  clave, y el cliente puede corregirlo y reintentar con la misma.

## Límite: la recuperación es "al menos una vez"

Si el proceso se cae **después** de que la operación tuvo efectos (la notificación se creó, el email
salió) pero **antes** de guardar el resultado, la retoma la ejecuta de nuevo. Es una ventana muy chica,
pero existe. Para cerrarla del todo:

- **Efectos en la base:** guardar el resultado de la clave en la misma transacción que la operación.
  Exige que el caso de uso conozca la clave; el middleware genérico no puede hacerlo.
- **Efectos en un proveedor externo:** pasarle la misma clave al proveedor si la soporta. Mercado Pago,
  Stripe y la mayoría de las APIs de pago aceptan `X-Idempotency-Key`. Así, aunque nosotros
  re-ejecutemos, el proveedor no cobra dos veces. **Para pagos es obligatorio.**

## Dónde se usa (y por qué solo ahí)

Solo donde un duplicado hace daño y el cliente tiene motivos para reintentar:

| Endpoint | Quién llama | Qué se duplicaría |
|---|---|---|
| `POST /client/api/v1/notification/notifications` | Otros sistemas (`X-API-Key`), de servidor a servidor | Una notificación a un usuario o a todos |
| `POST /admin/api/v1/notification/notification-types/global` | Admin | Una notificación a **todos** los clientes |
| `POST /admin/api/v1/notification/notification-types/direct` | Admin | Una notificación directa |

Lo demás no lo necesita:
- **Cambios de estado** (aprobar, revocar, reconocer, reenviar un fallo): la segunda vez ya no aplica
  (409 o 400), así que son idempotentes por naturaleza.
- **Altas con un dato único** (usuario, persona, registro): la segunda da 409 por la restricción UNIQUE.
- **Login, refresh, MFA:** tienen sus propios mecanismos (rotación de tokens, ventana de gracia, rate limit).

En esas rutas, `idempotent()` reemplaza al `RequestLockMiddleware`: la clave resuelve las peticiones
simultáneas (la segunda recibe 409 temporal) y además los reintentos posteriores, que el lock no cubre.

## Usarlo en una ruta nueva

```ts
import { idempotent } from '../../../shared/presentation/http/idempotency/idempotency.middleware';

router.post(
  '/payments',
  AuthMiddleware.authenticate,            // 1. quién llama (define el scope)
  validate({ body: CreatePaymentBody }),  // 2. validar: un body inválido no gasta la clave
  idempotent(),                           // 3. reclamar la clave
  PaymentController.create
);
```

Y en la documentación de la operación:
`parameters: [commonResponses.IdempotencyKeyHeader]`, `...commonResponses.RequestInProgress` y
`commonResponses.IDEMPOTENCY_DESCRIPTION` en la descripción.

## Del lado del cliente

```ts
const key = crypto.randomUUID();            // una vez por operación, NO por intento
for (let attempt = 1; attempt <= 3; attempt++) {
  const res = await fetch(url, { method: 'POST', body, headers: { 'Idempotency-Key': key, … } }).catch(() => null);
  if (res && !(await res.clone().json()).retryable) return res;   // éxito o error permanente
  await sleep(Number(res?.headers.get('Retry-After') ?? 2 ** attempt) * 1000);
}
```

## Para estudiar el código

- `idempotency.middleware.ts`: el flujo completo, comentado paso a paso.
- `idempotency.repository.ts`: las operaciones atómicas (`claim`, `takeOver`, `complete`, `release`).
- `tests/integration/idempotency.test.ts`: cada caso de la tabla de arriba contra Postgres real, incluidos
  la ráfaga simultánea, la retoma tras una caída y la liberación ante un error temporal.
- `tests/integration/notification-idempotency.test.ts`: punta a punta con la app real.
