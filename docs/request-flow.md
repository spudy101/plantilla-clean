# Flujo de request, errores y contexto — guía de onboarding

> Cómo viaja un request por la app: middlewares globales, autenticación, RBAC, rate-limit, request-lock,
> validación, controller→service, y manejo centralizado de errores. Auditoría en `docs/audit-and-observability.md`; RBAC en
> `docs/rbac/rbac.md`; enmascaramiento de PII en `docs/pii-masking.md`.

## Pipeline completo

```
Request
 → [middlewares globales src/app.ts]
 → [middlewares de ruta]  Auth → RBAC → RateLimit → RequestLock → validate(esquemas Zod)
 → Controller → Service → Repository → Model → DB
 → ApiResponse  (o AppError → ErrorMiddleware.handleError)
```

| Capa       | Responsabilidad                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| Controller | recibe req, llama validator+service, devuelve `ApiResponse`. Sin lógica de negocio. |
| Service    | toda la lógica; lanza `AppError`; audita con `audit.record`. No accede a DB directo. |
| Repository | único lugar con el cliente de Prisma; extiende `PrismaRepository`.                  |
| Schema     | `prisma/schema.prisma` (tablas, relaciones); la PII la cifra la extensión del cliente. |
| Request    | esquema Zod en `requests/`: valida, tipa y documenta la entrada.                    |
| DTO        | arma la respuesta en camelCase, campo a campo (nunca spread de una fila).            |

## Middlewares globales (`src/app.ts`) — ORDEN CRÍTICO

```ts
app.set('trust proxy', 1);
app.use(operationMiddleware); // 1. operación: id, contexto (AsyncLocalStorage), fila en `operations`, log HTTP (PRIMERO)
app.use(SecurityMiddleware.helmet()); // 2. headers de seguridad
app.use(SecurityMiddleware.cors());
app.use(SecurityMiddleware.addSecurityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' })); // 3. body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(handleMalformedJson); //    JSON inválido → 400 controlado
app.use(compression());
// GET /health, GET /, y las rutas de cada audiencia: /admin/… y /client/… (cada una con su Swagger en /docs)
```

`operationMiddleware` va primero: todo lo que viene después (incluidos los errores) queda dentro de la
operación y comparte su `correlationId`. **No reordenar.** Detalle en `docs/audit-and-observability.md`.

## Middlewares de ruta (orden recomendado)

```js
router.post(
  '/recurso/:id',
  AuthMiddleware.authenticate, // 1. pobla req.user (debe ir antes de RBAC)
  RbacMiddleware.requirePermission(RBAC_MODULES.X, RBAC_ACTIONS.UPDATE), // 2. autoriza
  RateLimitMiddleware.apiLimiter(), // 3. rate limit
  RequestLockMiddleware.forAuthenticatedUsers(), // 4. dedup de requests concurrentes
  validate({ params: MyIdParams, body: UpdateMyBody }), // 5. validación (422 si falla)
  MyController.update // 6. controller
);
```

> ❌ Gotcha: RBAC antes que Auth = `req.user` undefined → falla. Auth SIEMPRE primero.

## `req.user` (tras AuthMiddleware.authenticate)

`auth.middleware.ts` valida un **JWT RS256 propio** con `JwtUtil.verifyAccessToken` (autenticación 100% propia:
la contraseña se valida contra el hash en BD en el login; en mobile además firma HMAC con ventana de 10 s),
revisa device blocklist + token blacklist + **inactividad de 15 min para TODO usuario autenticado** (cliente e
interno, con `last_access_at` deslizante; lo único que cambia por rol es el texto del 401), y puebla:

`{ sessionId, userId, personId, roleId, roleName, firstName, lastName, email, nationalId, canal('web'|'mobile'),
username, authUsername, tokenIat, tokenExp }`

Variantes: `authenticate` (sin exigir rol), `optionalAuthenticate` (nunca falla; la usa el widget del
asistente), `requireRole(roles)` (legacy — en rutas admin nuevas usar RBAC), `externalAuthenticate`
(x-api-key para servicios externos, ej. `POST /notifications`) y `externalWebhookAuthenticate` (api key por
query string, para webhooks).

## Contexto de la operación

`operationMiddleware` deja el contexto en AsyncLocalStorage (`requestContext.get()`) y una copia en
`res.locals.auditContext`: `{ correlationId, source, name, ip, userAgent, fingerprintHash, method, path }`;
`auth.middleware` le agrega `userId` y `sessionId` al autenticar. Logger, auditoría y llamadas externas lo
toman solos. Los controllers admin arman el contexto del actor con `adminAuditContext(req, res)` cuando el
service necesita esos datos explícitos (para persistir o notificar).

## Errores — `AppError` + handler global

`src/shared/http/app-error.util.ts` — lanzar SIEMPRE `AppError` (nunca `throw 'string'`), sin try/catch en
controllers/validators (el `asyncHandler` reenvía al handler global).

| Factory                                                | HTTP | code                 |
| ------------------------------------------------------ | ---- | -------------------- |
| `AppError.badRequest(msg, details?)`                   | 400  | BAD_REQUEST          |
| `AppError.unauthorized(msg, details?)`                 | 401  | UNAUTHORIZED         |
| `AppError.forbidden(msg, details?)`                    | 403  | FORBIDDEN            |
| `AppError.notFound(msg, details?)`                     | 404  | NOT_FOUND            |
| `AppError.conflict(msg, details?)`                     | 409  | CONFLICT             |
| `AppError.unprocessableEntity(msg, details?)`          | 422  | UNPROCESSABLE_ENTITY |
| `AppError.tooManyRequests(msg, details?, retryAfter?)` | 429  | RATE_LIMIT           |
| `AppError.internal(msg, details?)`                     | 500  | INTERNAL_ERROR       |
| `AppError.serviceUnavailable(msg, details?)`           | 503  | SERVICE_UNAVAILABLE  |

El 2º arg `details` suele llevar `{ code: 'CODIGO_NEGOCIO' }` para que el front discrimine (ej.
`{ code: 'MFA_REQUIRED' }`, `{ code: 'DUAL_APPROVAL_SAME_AS_MAKER' }`).

`src/shared/http/error.middleware.ts`:

- `asyncHandler(fn)` envuelve el handler async y reenvía rechazos a `handleError`.
- `handleError`: loguea, guarda el error en la operación (`operations.error_code`/`error_message`) y responde. Solo
  los rechazos de seguridad se auditan además: 401→`AUTH_FAILURE`, 403→`ACCESS_DENIED`. Mapea también errores de Prisma (P2002 duplicado, P2025 no encontrado…), JWT y Multer.

## Respuestas — `ApiResponse`

`src/shared/http/app-response.util.ts`. Éxitos: `success(res, msg, data, statusCode=200, metadata)`,
`created` (201), `accepted` (202, doble aprobación), `noContent` (204). Errores:
`badRequest/unauthorized/forbidden/notFound/conflict/tooManyRequests/validationError/error`.

Estructura éxito: `{ success, statusCode, message, data, metadata, timestamp }`.
**Aplanado automático:** si `data` ya viene como `{ data, metadata }` (DTO de lista), `success()` lo aplana
a nivel raíz → por eso el controller pasa el resultado del service directo, sin desestructurar.

**Red de seguridad PII:** `success()` pasa `data` y `metadata` por `PiiMaskingMiddleware.apply(res, …)` — es la
capa C del enmascaramiento, invisible desde el controller. Detalle en `docs/pii-masking.md` §2.

## Rate limit y request lock

- `rate-limit.middleware.ts`: `apiLimiter()` (autenticados), `authLimiter()` (login; la capa por IP del login es `LoginIpLimiterMiddleware` en `modules/iam`),
  `forgotPasswordLimiter()`, `publicLimiter()`, `assistantLimiter()` (chat público). Store híbrido Redis +
  memoria; al exceder → 429 con `Retry-After`.
- `request-lock.middleware.ts`: `forAuthenticatedUsers()` / `forPublicEndpoints()`. Lock por
  `hash(userId|ip + method + path + body)` (clave por ruta → endpoints distintos no se bloquean entre sí);
  Redis `SET NX EX` atómico, se libera en `res.on('finish')`. Duplicado concurrente → 409 (auth) / 429 (público).
  Ante error o sin Redis, deja pasar (no bloquea la app).

## Correlation y trazabilidad

El `correlationId` es el id de la operación: lo genera siempre el servidor y lo devuelve en el header
`X-Correlation-Id` (el que mande el cliente se guarda aparte como `client_request_id`). Todos los logs, los
registros de auditoría y las llamadas a proveedores externos lo llevan: `GET /admin/api/v1/records/audit/operations/:id`
reconstruye la operación completa.

## Gotchas

- Auth antes de RBAC (si no, `req.user` undefined).
- No try/catch en controllers; usar `asyncHandler` + lanzar `AppError` en el service.
- No desestructurar `{ data, metadata }` en el controller — pasar el resultado del service directo a `ApiResponse.success`.
- Sin Redis, auth/rate-limit/lock tienen fallback a BD/memoria (los logouts se respetan vía `UserSession` en BD).
- Nunca loguear datos sensibles; el logger redacta igual los campos conocidos (password, token, nationalId, email…).
