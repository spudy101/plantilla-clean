# Autenticación, sesiones y tokens (RF-AUTH-02 / RF-AUTH-03) — guía de implementación

> Cómo funcionan el login, los tokens, las sesiones, su expiración y revocación; el detalle, los flujos y los gotchas
> viven aquí.

El sistema usa **autenticación 100% propia**: el password se valida contra el hash en BD en el login y
el segundo factor es **TOTP propio (RFC 6238)**; toda la autorización por request es con **JWT RS256
propios** (`JwtUtil`) + estado en Redis (`TokenBlacklistUtil`, `RefreshTokenStore`) con **fallback a BD**
(`user_sessions`). No interviene ningún proveedor de identidad externo.

> **Control vs. forense.** `/auth/sessions` (+ `logout*`, `devices`) es **control**: ver y revocar lo que está
> vivo. La traza forense —qué se hizo en una sesión ya cerrada, contra qué filas— es otra API, read-only y
> admin: `GET /records/audit/sessions[/:sessionId[/entities]]` (módulo RBAC `globalLogs`), documentada en
> `docs/audit-and-observability.md` junto con la columna `origin_session_id`.

---

## Piezas

| Pieza                                                             | Archivo                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Emisión/verificación JWT RS256 (access + refresh)                 | `src/shared/infrastructure/security/jwt.util.ts`                                               |
| Store de JTIs de refresh en Redis (rotación + reuse)              | `src/modules/iam/infrastructure/security/redis-refresh-token.store.ts`                               |
| Blacklist de tokens / umbrales de invalidación                    | `src/modules/iam/infrastructure/security/redis-token-revocations.ts`                                   |
| Validación por request (firma + blacklist + inactividad 15 min)   | `src/modules/iam/application/use-cases/authentication.use-cases.ts` (guarda: `presentation/http/auth.guards.ts`)                                  |
| Login / refresh / logout / logout-all / sesiones                  | `src/modules/iam/application/use-cases/login.use-cases.ts`, `session-lifecycle.use-cases.ts`, `sessions.ts`        |
| Login biométrico                                                  | `src/modules/iam/application/use-cases/biometric.use-cases.ts`              |
| Recuperación de credenciales (reset)                              | `src/modules/iam/application/use-cases/registration.use-cases.ts`               |
| Revocación de sesión por admin                                    | `src/modules/iam/application/use-cases/admin-sessions.use-cases.ts`           |
| Worker de expiración (inactividad + tope absoluto)                | `src/modules/iam/infrastructure/workers/session-expiration.worker.ts` (caso de uso `ExpireSessions`)           |
| Modelo de sesión                                                  | `src/modules/iam/domain/session.ts` + `infrastructure/persistence/prisma-user-session.repository.ts` (`user_sessions`) |

---

## Tokens — valores y semántica

| Token       | Vida                                              | Dónde                                                                      | Notas                                                                                    |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Access**  | **15 min** (`config.jwt.accessTokenExpiry = 900`) | JWT RS256, claims completos del usuario                                    | Web: cookie httpOnly. Móvil: `Bearer`. Cada respuesta de auth devuelve `expiresIn: 900`. |
| **Refresh** | **24h tope absoluto**                             | JWT RS256 `type:'refresh'` + JTI en Redis (`refresh:jti:{jti}`, TTL 86400) | `exp` y TTL Redis alineados en 86400. Rotativo.                                          |

El `maxAge` de las cookies sigue la vida **real** de cada token: `access_token` 15 min,
`refresh_token` 24h (`auth-login.controller.ts`, `auth-register.controller.ts`). Una cookie que vive
más que su token deja al navegador mandando credenciales muertas y al front creyendo que hay sesión.
`clearCookie` repite los mismos atributos (`sameSite`/`secure`/`path`) — sin eso varios navegadores
no borran nada.

> El canal (web/mobile) se detecta por **presencia de la cookie**, con `x-client-type: web` como
> señal adicional. No puede depender solo del header: si el interceptor lo omite en `/auth/refresh`,
> el back rotaba el token y no devolvía las cookies nuevas, dejando al navegador con un refresh ya
> revocado que en la siguiente llamada se leía como reuse attack.

La vida real de la sesión es **mucho menor** que el tope de 24h del refresh: muere por **inactividad
(15 min, cliente e interno)**, **tope absoluto (8h desde `started_at`)**, **logout**, **rotación/reuse** o
**revocación**. El refresh se emite a 24h, pero la sesión **nunca** pasa de 8h (tope absoluto, Circular 052/2007 SFC),
así que los 24h del token son solo el techo del token, jamás de la sesión.

> ⚠️ `config.jwt.refreshTokenExpiry` (604800) es **legacy**: ya no se consume en código. El tope real
> son 24h, fijados en `JwtUtil.generateRefreshToken` (`exp`) y `RefreshTokenStore` (TTL Redis).

---

## El modelo `user_sessions`

`status: 'active' | 'closed'`, `started_at`, `last_access_at`, `closed_at`, `close_reason`, `jti`,
`device_id`. **`close_reason` es STRING libre** (no enum) — valores usados:

| `close_reason`       | Origen                                                    |
| -------------------- | --------------------------------------------------------- |
| `logout`             | logout individual                                         |
| `logout_all`         | logout de todas las sesiones                              |
| `logout_others`      | cerrar las demás sesiones                                 |
| `closed_by_user`     | el usuario cierra otra sesión propia (`closeSessionById`) |
| `reauth_same_device` | nueva sesión en el mismo dispositivo                      |
| `session_limit`      | se superó `MAX_ACTIVE_SESSIONS` (5)                       |
| `revoked_by_admin`   | revocación por admin                                      |
| `password_reset`     | reset de contraseña                                       |
| `inactivity_timeout` | inactividad 15 min (middleware **y** worker, cliente e interno) |
| `absolute_lifetime`  | tope absoluto de 8h desde `started_at` (refresh **y** worker)  |

---

## Límites del endpoint `/auth/refresh`

El refresh se llama **en bucle por diseño** (~1 cada 14 min por sesión, más las ráfagas del front),
así que sus límites se agrupan por **sesión**, nunca por IP: detrás de una IP pública conviven varios
usuarios que se consumían el cupo entre sí y se quedaban sin poder renovar.

| Middleware                             | Clave                                   | Regla                                    |
| -------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `RateLimitMiddleware.refreshLimiter()` | `session:{sessionId}` (IP como fallback) | `RATE_LIMIT.REFRESH_MAX_REQUESTS` 30 / 15 min |
| `RequestLockMiddleware.forRefresh()`   | `sessionId` hasheado                    | dedupe `TTL.REQUEST_LOCK_PUBLIC` (3 s)   |

El `sessionId` sale de `JwtUtil.decodeUnverified(token)` — decodifica **sin verificar firma**, solo
para agrupar. Nunca usar ese payload para autorizar: el token se valida en el caso de uso (`RefreshTokens`).

> ❌ **No usar `authLimiter()` ni `forPublicEndpoints()` en el refresh.** Su `keyGenerator` cae a
> `ip:` cuando el body no trae `email`/`username` — y el refresh manda el token por cookie, jamás en
> el body. Era el embudo que dejaba sin renovar a todos los usuarios de una misma IP.

---

## Las 3 capas de invalidación (TokenBlacklistUtil)

Como el middleware verifica el JWT **localmente** (firma RS256), un token válido seguiría pasando
hasta su `exp` salvo que algo lo invalide en Redis. Tres mecanismos, de menor a mayor alcance:

1. **Blacklist por valor** (`blacklistAccessToken`/`blacklistRefreshToken`): hash del token concreto.
   Se usa cuando se tiene el token en mano (logout).
2. **Umbral por sesión** (`blacklistSession(sessionId)` / `invalidateSessionTokensBefore`): rechaza
   todo access token de esa sesión con `iat < umbral`, con efecto **inmediato**. **Quirúrgico**: mata
   una sesión sin tocar las demás. Lo usan `closeSessionById`, `_enforceSessionLimit`,
   `_closePreviousDeviceSessions`, el **revoke admin** y el **worker**. La **rotación del refresh**
   usa la misma clave con otra semántica (`invalidateSessionTokensOnRotation`, valor `rotation:{ts}`):
   el umbral solo rechaza pasados los 60 s de gracia — ver "Rotación de refresh" abajo.
3. **Umbral global del usuario** (`invalidateUserSessions(userId)`): rechaza **todos** los tokens del
   usuario con `iat <= timestamp`. Solo para tumbar TODAS las sesiones: **logout-all**, **reset de
   contraseña**, **reuse attack**.

> 🔑 Regla: cerrar **una** sesión ⇒ `blacklistSession(sessionId)` + `RefreshTokenStore.revoke(jti)`.
> Nunca `invalidateUserSessions` para una sola sesión (mataría las demás). Cerrar **todas** ⇒
> `invalidateUserSessions` + `closeAllByUser`.

El middleware (`_checkTokenBlacklist`) chequea las 3 en cada request. **Fallback a BD**: si Redis no
está disponible, valida `user_sessions.status` (`_assertSessionActiveDbFallback`) — una sesión
`closed` en BD se rechaza igual.

---

## Rotación de refresh + detección de reuse (`auth-login.service.ts#refreshToken`)

El refresh es **rotativo**. En cada uso:

1. Verifica firma (`verifyRefreshToken`).
2. **Ventana de gracia** (`RefreshTokenStore.getRotation`) — ver sección propia abajo. Si el JTI fue
   rotado hace menos de `SECURITY.REFRESH_ROTATION_GRACE_SECONDS` (60 s), devuelve el par ya emitido
   y termina. Va **antes** que todo lo demás: la rotación deja el token viejo marcado en la blacklist
   y sin JTI, así que una llamada concurrente moriría en los pasos 3-5 sin llegar nunca acá.
3. Blacklist individual del refresh (logout de esta sesión).
4. Invalidación global del usuario — `isUserSessionsInvalidated(userId, iat)`, **comparando contra el
   `iat`**: un login posterior al evento emite tokens que sí deben poder renovar.
5. Comprueba el JTI en Redis. Si no existe, distingue tres casos:
   - **Redis no disponible** ⇒ fail-open, se deja pasar la rotación (una caída de infra no es un robo).
   - **Sesión cerrada en BD** (`status != 'active'`) ⇒ 401 `SESSION_CLOSED`. No es ataque: logout desde
     otro dispositivo, revocación del admin o worker de inactividad también revocan el JTI.
   - **Resto** ⇒ **reuse attack**: `audit.record('REFRESH_TOKEN_REUSE_ATTACK')` +
     `invalidateUserSessions(userId)` (mata TODAS las sesiones) + 401 `SESSION_COMPROMISED`.
6. `RefreshTokenStore.revoke(jtiViejo)` **antes** de emitir el nuevo.
7. Emite nuevo access + nuevo refresh (`newJti`, mismo `sessionId`) y `RefreshTokenStore.save(newJti)`.
8. `_applyRotationSideEffects`: `blacklistRefreshToken(viejo)` +
   `invalidateSessionTokensOnRotation(sessionId, refreshTs)` (mata el access anterior de esa sesión
   con **efecto diferido**: el umbral solo rechaza pasados los 60 s de gracia desde la rotación) +
   `updateJtiAndLastAccess(sessionId, newJti)` en BD (rota el `jti` y **actualiza `last_access_at`**).
9. `RefreshTokenStore.saveRotation(jtiViejo, tokens)` — **awaited**, abre la ventana de gracia. Si se
   resolviera después de responder, la ráfaga que viene atrás la encontraría vacía.

El token viejo "muere" por **revocación inmediata del JTI**, no por TTL — por eso quitarle al refresh
una expiración corta es seguro: el robo se detecta por reuse, no por caducidad.

### La ventana de gracia (60 s) — por qué existe

El refresh es de un solo uso, pero el front web **no puede coordinar**: la cookie es `httpOnly` y
varias pantallas montando a la vez disparan varias llamadas con el access recién vencido. Todas
fallan, todas piden refresh con **la misma cookie**, y solo la primera rota. Sin ventana, las demás
llegan con un JTI ya revocado y se leían como reuse attack — que cierra **todas** las sesiones del
usuario. Era la causa de deslogueos recurrentes con una sola pestaña abierta.

`refresh:rotated:{jtiViejo}` guarda el par emitido durante 60 s: dentro de esa ventana, cualquier
llamada con ese JTI recibe **ese mismo par**. Una sola rotación, todas las llamadas coherentes.

No abre un agujero: la clave solo existe si **nosotros** rotamos ese JTI hace menos de 60 s. Un logout
blacklistea el token pero no escribe esa clave, así que ahí no hay gracia posible. El costo real es
acotado: un refresh robado y usado dentro de esa ventana obtiene el mismo par que el usuario legítimo
(que es exactamente lo que obtendría ganando la carrera, con o sin ventana).

La misma gracia se aplica al umbral que invalida el access anterior (paso 8), pero contada **sobre la
hora del request, no sobre el `iat`**: el front rota proactivamente a los ~11-14 min, así que el access
anterior siempre tiene un `iat` de minutos atrás y un margen por `iat` no lo salvaría nunca. El umbral
de rotación se guarda como `rotation:{ts}` en la clave `token:session:invalidated_at:{sessionId}` y
solo empieza a rechazar cuando pasaron 60 s desde la rotación — los requests en vuelo con la cookie
vieja terminan bien y el token anterior muere igual, unos segundos después (o antes, por su propio
`exp`). Los cierres/revocaciones (`blacklistSession`, valor numérico plano en la misma clave) siguen
siendo **inmediatos**: la semántica diferida es exclusiva de la rotación.

---

## Expiración: inactividad (15 min) + tope absoluto (8h) — middleware + worker

Dos causas de cierre, cada una con dos mecanismos (reactivo en middleware + proactivo en worker), para
**cliente e interno por igual**:

- **Inactividad — 15 min** (`SECURITY.SESSION_INACTIVITY_MINUTES`). `last_access_at` es la señal fiel: el
  middleware lo actualiza en **cada request autenticado** (con throttle de 60s, `SESSION_ACCESS_THROTTLE_SECONDS`).
  - **Middleware (reactivo):** `_enforceInactivity` cierra la sesión si `last_access_at + 15 min < now` en su
    **siguiente request** (internos re-loguean con 2FA).
  - **Worker (proactivo):** `session-expiration.worker.ts` (`*/5 * * * *`, cada 5 min) barre las sesiones huérfanas del
    usuario que "cerró la pestaña/app y no volvió" — sin él la fila quedaría `active` para siempre.
- **Tope absoluto — 8h desde `started_at`** (`SECURITY.ABSOLUTE_SESSION_LIFETIME_HOURS`, Circular 052/2007 SFC).
  La rotación del refresh **no** resetea la vida de la sesión.
  - **Refresh (reactivo):** `_enforceAbsoluteSessionLifetime` rechaza el refresh y cierra la sesión si se pasó de 8h.
  - **Worker (proactivo):** el mismo barrido cierra sesiones con `started_at + 8h < now` aunque sigan activas.

El worker consulta `findClosableActive(inactivityCutoff, absoluteCutoff)` (OR de ambas condiciones) y, por cada
cierre: `closeSession(...,reason)` → `RefreshTokenStore.revoke(jti)` → `TokenBlacklistUtil.blacklistSession(sessionId)`
→ `audit.record(action,'system',…)`, donde `reason`/`action` son `absolute_lifetime`/`SESSION_ABSOLUTE_EXPIRED` si superó
las 8h, o `inactivity_timeout`/`SESSION_EXPIRED_BY_WORKER` si fue inactividad.

> 🛡️ **Idempotencia anti-carrera.** `closeSession` solo afecta filas `status='active'`. El worker lee
> el `affectedCount`: si es 0 (el middleware ya la cerró entre el `find` y el `update`), **no** hace
> blacklist/revoke/auditoría — así no se duplican.

---

## `last_access_at` — dónde se actualiza

| Lugar                                                            | Cuándo                                   |
| ---------------------------------------------------------------- | ---------------------------------------- |
| `auth-login.service.ts` / `auth-biometric.service.ts` (`create`) | al crear la sesión (login)                      |
| `user-session.repository.ts#updateJtiAndLastAccess`              | en cada **refresh** (todos los usuarios)        |
| `auth.middleware.ts` (`_enforceInactivity`, ventana deslizante)  | en cada **request autenticado** (cliente + interno), con throttle de 60s |

Es la señal única de inactividad para el worker y para "Mis dispositivos" (RF-AUTH-03), fiel al último uso real
de cualquier API.

---

## Contrato de errores 401 con el front (`AUTH_ERROR_CODES`)

Todos los 401 salían con `code: 'UNAUTHORIZED'` y solo se distinguían por el texto del mensaje, así
que el front no podía separar "el access venció, renová y reintentá" de "la sesión murió, andá a
login" — y ante la duda deslogueaba. Ahora cada 401 lleva su código en **`details.code`** (mismo
patrón que `MFA_REQUIRED`), catalogado en `src/shared/infrastructure/config/index.ts#AUTH_ERROR_CODES`.

| `details.code`              | Origen                                                        | Qué debe hacer el front     |
| --------------------------- | ------------------------------------------------------------- | --------------------------- |
| `TOKEN_EXPIRED`             | `jwt.util.ts#verifyAccessToken` — access vencido               | **Refrescar y reintentar**  |
| `TOKEN_INVALID`             | firma inválida / malformado                                    | Desloguear                  |
| `SESSION_CLOSED`            | logout, logout-all, revocación admin, sesión cerrada en BD     | Desloguear                  |
| `SESSION_INACTIVITY`        | 15 min sin pegarle a ninguna API                               | Desloguear (interno: + 2FA) |
| `SESSION_ABSOLUTE_LIFETIME` | tope de 8h desde `started_at`                                  | Desloguear                  |
| `SESSION_COMPROMISED`       | reuse attack — **todas** las sesiones cerradas                 | Desloguear                  |
| `REFRESH_TOKEN_INVALID`     | refresh vencido, revocado o ausente                            | Desloguear                  |
| `DEVICE_BLOCKED` (403)      | dispositivo en blocklist                                       | Mensaje de dispositivo      |

**Regla para el front: `TOKEN_EXPIRED` es el único recuperable. Cualquier otro ⇒ login.** El 429 del
refresh (`refreshLimiter`) tampoco es un deslogueo: se reintenta con backoff.

---

## Logout y revocación — matriz

| Operación                 | Método                                                              | BD                                     | Redis                                                                           |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| Logout individual         | `logout`                                                            | `closeSession(...,'logout')`           | `blacklistAccessToken` + `blacklistRefreshToken`                                |
| Logout todas              | `logoutAll`                                                         | `closeAllByUser(...,'logout_all')`     | `blacklistAccessToken` + **`invalidateUserSessions`**                           |
| Cerrar otras sesiones     | `closeOtherSessions`                                                | `closeAllByUserExcept`                 | por cada una: `revoke(jti)` + `blacklistSession`                                |
| Cerrar otra sesión propia | `closeSessionById`                                                  | `closeSession(...,'closed_by_user')`   | `revoke(jti)` + **`blacklistSession`**                                          |
| **Revoke admin**          | `AdminAuthSessionService.revokeSession`                             | `closeSession(...,'revoked_by_admin')` | `revoke(jti)` + **`blacklistSession`** (quirúrgico)                             |
| Reset de contraseña       | `confirmResetCredentials` → `_invalidateSessionsAfterPasswordReset` | `closeAllByUser(...,'password_reset')` | **`invalidateUserSessions`**                                                    |

> 🔑 El **revoke admin** usa `blacklistSession` (quirúrgico): revocar UNA sesión no afecta las demás
> del usuario. (Bug corregido: antes usaba `invalidateUserSessions`, que las tumbaba todas.)

---

## Login biométrico (`auth-biometric.service.ts#loginFinish`)

Es un esquema **challenge-response ES256 propio** (no WebAuthn/FIDO2 — sin librería, sin attestation,
sin binding de origin; `signCount` lo envía el cliente). Tras verificar la firma ES256 contra la
`public_key` guardada, **emite tokens propios** igual que el login por contraseña:

1. `_closePreviousDeviceSessions` + `_enforceSessionLimit`.
2. `JwtUtil.generateAccessToken` + `generateRefreshToken` + `RefreshTokenStore.save(jti)`.
3. Crea la fila en `user_sessions`.
4. Devuelve `LoginResponseDTO` con `tokens` (incluye `expiresIn: 900`) + `deviceHmacSecret`.

> ❌ **Nunca** reintroducir `password_hash_plain` (password reversible en BD). La firma ES256 ya es la
> autenticación; los tokens los emite el sistema. El campo fue eliminado de este flujo.

---

## Reglas para tocar este dominio

- Cerrar **una** sesión ⇒ `closeSession` + `RefreshTokenStore.revoke(jti)` + `TokenBlacklistUtil.blacklistSession(sessionId)`. Cerrar **todas** ⇒ `closeAllByUser*` + `invalidateUserSessions`.
- `audit.record` de sesión/dispositivo: `entityType:'UserSession'`/`entityTable:'user_sessions'` y
  `entityType:'UserTrustedDevice'`/`entityTable:'user_trusted_devices'` (homologado).
- Acciones de auditoría disparadas por workers usan `userId:'system'` (ej. `SESSION_EXPIRED_BY_WORKER`,
  `SESSION_ABSOLUTE_EXPIRED`).
- No leer `process.env` fuera de `src/shared/infrastructure/config/`. Inactividad unificada cliente+interno:
  `SECURITY.SESSION_INACTIVITY_MINUTES` (15); tope absoluto: `SECURITY.ABSOLUTE_SESSION_LIFETIME_HOURS` (8);
  throttle de `last_access_at`: `SECURITY.SESSION_ACCESS_THROTTLE_SECONDS` (60); gracia de rotación:
  `SECURITY.REFRESH_ROTATION_GRACE_SECONDS` (60).
- **Todo 401 nuevo lleva su `AUTH_ERROR_CODES` en `details.code`.** Un 401 sin código obliga al front a
  adivinar entre renovar y desloguear, y siempre elige mal.
- **Nada que se llame en bucle se limita por IP.** Vale para el refresh y para cualquier endpoint de
  keepalive/polling que se agregue: la clave es la sesión o el usuario.
- Antes de declarar un incidente de seguridad (reuse attack), descartar las causas benignas: Redis
  caído, rotación reciente (ventana de gracia) y sesión ya cerrada en BD. Un falso positivo acá
  desloguea al usuario de todos sus dispositivos.

---

## Gaps conocidos / deuda

- ~~`last_access_at` de clientes solo avanza en refresh~~ **Cerrado (2026-07-07):** ahora se actualiza en cada
  request autenticado para cliente e interno (con throttle de 60s) en `_enforceInactivity`. La inactividad quedó
  unificada a 15 min y se agregó el tope absoluto de 8h (refresh + worker).
- El **login biométrico** es challenge-response propio, no FIDO2: el backend no garantiza hardware
  seguro ni que hubo biometría real (confía en el dispositivo trusted); `signCount` es manipulable
  (el anti-replay real es el challenge de un solo uso); `loginStart` expone `userId` (endpoint público).
- ~~`_completeSuccessfulLogin` no llama `_closePreviousDeviceSessions`~~ **Cerrado (2026-07-23,
  decisión del dev):** el login por password ahora cierra la sesión previa del mismo dispositivo
  (`reauth_same_device`) antes de aplicar el tope, igual que el biométrico. Una sesión abandonada del
  mismo dispositivo ya no consume cupo de `MAX_ACTIVE_SESSIONS` (5) ni depende del worker para cerrarse.
- El front puede mantener viva una sesión indefinidamente con un **keepalive por temporizador**
  (`GET /person/profile` cada 2 min renueva `last_access_at` igual que cualquier otra API). Eso anula
  de hecho la inactividad de 15 min de la Circular 052/2007 para una pantalla abandonada. Lo correcto
  es atar ese ping a actividad real del usuario; hoy depende de la disciplina del front.
