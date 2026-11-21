# Doble aprobación global (maker-checker) — guía de implementación

> Cómo funciona y cómo extender el framework de cuatro ojos; el detalle vive aquí.

Mecanismo declarativo y reutilizable: una operación sensible ejecutada por un funcionario (maker)
queda **pendiente** hasta que un segundo funcionario distinto (checker) la aprueba; recién ahí se
ejecuta la acción real. El "estado doble aprobación" de toda operación gateada por este framework vive en
**una sola tabla genérica** (`approval_requests`) — no se duplican columnas ni máquina de estados por tabla.

## Siempre activo — sin interruptor

El maker-checker **no se puede apagar**. No hay env var ni flag de configuración: cada operación del
registro se gatea según su `condition` (`ALWAYS`, o `THRESHOLD` sobre un campo del payload), y una
operación que califica **siempre** responde `202` y crea su `approval_request`.

> ❌ Nunca "comentar" `src/shared/constants/dual-approval.ts` para desactivar: el middleware y el bootstrap
> lo requieren al arrancar y el server no levantaría.

## Las 3 piezas

| Pieza                                                                     | Archivo                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registro declarativo (`DUAL_APPROVAL_OPS`, `WILDCARD_ROLES`, `CONDITION`) | `src/shared/constants/dual-approval.ts`                                                                                                                                                            |
| Tabla + capa de datos + core + worker + bootstrap                         | `src/modules/approvals/` (`models/approval-request.model.ts`, `repositories/approval-request.repository.ts`, `services/dual-approval.service.ts`, `workers/dual-approval-expiration.worker.ts`, `dual-approval.bootstrap.ts`) |
| Endpoints admin                                                           | `src/modules/approvals/routes/approval-request.routes.ts` (+ controller)                                                                                                                          |

Componentes shared: `src/modules/approvals/middlewares/dual-approval.middleware.ts`,
`src/modules/approvals/responses/approval-components.response.ts` (`ApprovalRequestComponent`, `PendingApprovalComponent`).
El schema Swagger `PendingApproval` vive en `src/config/swagger/schemas/core.schema.ts` (compartido admin+client).

## API del core · `DualApprovalService`

```js
register(opKey, onApprove, onReject?)   // bootstrap: handler IoC que ejecuta la acción real al resolver
requiresApproval(opKey, payload)        // 'always' ⇒ true; 'threshold' ⇒ payload[thresholdField] > umbral(BD||default)
async gate(opKey, { entityType, entityId, payload, ctx })
   // -> { pending:false } si no requiere (ejecuta directo)
   // -> { pending:true, request } si requiere: crea approval_request, calcula expires_at (horas
   //    hábiles), notifica approverRoles (setImmediate), audit.record('DUAL_APPROVAL_REQUESTED')
   // -> 409 (DUAL_APPROVAL_ALREADY_PENDING) si ya hay una pendiente para (operation_key, entity_id)
   // -> super_admin: { pending:false, autoApproved:true, request } (ver bypass abajo)
async resolve(requestId, { decision, notes }, approverCtx)
   // valida status===pending, rol ∈ approverRoles ∪ WILDCARD_ROLES, approver !== requested_by
   // approve -> invoca onApprove(payload, ctx); status=approved; result; audit.record('DUAL_APPROVAL_APPROVED')
   // reject  -> invoca onReject(payload, ctx) si existe; status=rejected; audit.record('DUAL_APPROVAL_REJECTED')
async annotatePending(entityType, rows, idField = null)  // anota cada row con .pendingApproval | null (1 query batch)
async list(query) / async getById(id)    // listado paginado + detalle para los endpoints admin
async getPolicy()                        // { enabled:true, operations:[...] } — `enabled` hardcodeado (no hay interruptor)
```

### Bypass por rol — `super_admin`

Única excepción real a "cuatro ojos siempre": `gate()` detecta al superadmin (`isSuperAdmin`, contra
`SUPERADMIN_ROLE_NAMES`), crea igual la solicitud pero ya **`approved` por el propio maker**
(`requested_by === second_approver_id`, traza completa) y devuelve `{ pending:false, autoApproved:true,
request }`, **sin** invocar el handler IoC — la acción corre inline en el mismo request (el flujo normal la
ejecuta una sola vez). Audita `DUAL_APPROVAL_REQUESTED` + `DUAL_APPROVAL_AUTO_APPROVED`.

> En el template base, `SUPERADMIN` omite el gate; `ADMIN` **sí** está sujeto a doble aprobación. Ver
> `docs/rbac/rbac.md`.

## Dos formas de gatear (ambas terminan en el handler registrado)

- **Middleware de ruta** `DualApprovalMiddleware.require('OP_KEY', { shouldGate?, extractPayload?, extractEntity? })`
  → operaciones cuyo disparo se decide con `req.body`/`req.params`. Si la op queda pendiente responde
  `202` y NO llama al controller. `shouldGate(req)` permite gatear solo el caso sensible en endpoints
  multipropósito.
- **Gate a nivel de servicio** `DualApprovalService.gate('OP_KEY', {...})` → cuando la condición se
  calcula a mitad del flujo (p. ej. un umbral que depende de un valor ya validado). Las 3 operaciones del
  template gatean **en el service**.

## Reanudación = handler (IoC), no se re-ejecutan requests

El handler y el controller "normal" delegan en **el mismo método de service** → la lógica no se
duplica; solo hay dos puntos de entrada (ejecución directa vs. tras aprobación). El handler debe ser
**idempotente** (puede reintentarse). Se registran en `dual-approval.bootstrap.ts`, invocado una vez al
arranque desde `src/server.ts` antes de arrancar los workers.

## Operaciones gateadas (3)

El registro (`DUAL_APPROVAL_OPS`) trae, en el template base, **tres** operaciones — todas `condition:
always`, todas sobre la entidad `User`/`users`, con `approverRoles: ['ADMIN']` y `ttlHours: 72`:

| `operation_key`        | Qué gatea                                    | Handler (service)                       | Gate       |
| ---------------------- | -------------------------------------------- | --------------------------------------- | ---------- |
| `RBAC_ROLE_CHANGE`     | Cambio de rol de un usuario interno          | `AdminUserService.executeChangeRole`    | servicio   |
| `CLIENT_ACCOUNT_DELETE`| Eliminación de cuenta de cliente (irreversible) | `PersonService.executeDeleteAccount` | servicio   |
| `INTERNAL_USER_DELETE` | Eliminación de usuario interno (irreversible)| `AdminUserService.executeDeleteUser`    | servicio   |

- Los tres avisan a los aprobadores con el tipo de notificación `RBAC_SECOND_APPROVER`; al resolverse,
  el maker recibe `DUAL_APPROVAL_RESOLVED`.
- Ninguna registra hoy `onReject` (el framework lo soporta): el rechazo solo cierra el `approval_request`,
  sin acción de dominio que deshacer.
- **Roles aprobadores:** `approverRoles = ['ADMIN']`; los **wildcard** (`SUPERADMIN`, `ADMIN`) siempre
  pueden resolver. La segregación (`second_approver_id !== requested_by`) impide que el maker se apruebe
  a sí mismo aunque tenga el rol.

> El framework soporta `condition: threshold` (umbral sobre un campo del payload, con override en
> `SystemGlobalConfig` vía `thresholdConfigKey` y `thresholdDefault`), pero **ninguna operación del
> template lo usa** hoy. Es el gancho para cuando derives un dominio con montos/límites.

## Contrato con el front

- Operación gateada pendiente → **`202 Accepted`** con el `approval_request` (usar `ApiResponse.accepted`).
- `GET /api/v1/core/approval-requests/policy` → qué operaciones están gateadas + `enabled: true`.
- En los **listados** de módulos gateados, el service llama `annotatePending(entityType, rows)` y el DTO
  expone `pendingApproval: {...} | null` por item (camelCase) → el front pinta el badge. El objeto lleva
  `approvalRequestId` (para redirigir al detalle `/core/approval-requests/:id`) + `operationKey` +
  `status`/`requestedBy`/`requestedAt`/`expiresAt`. En el template, la entidad anotada es `User`.
- Resolución (única vía para todas las ops): `POST /api/v1/core/approval-requests/:id/resolve`.

## Endpoints (módulo `core`, servidor admin)

| Método | Ruta                                         | RBAC                                                                               |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/api/v1/core/approval-requests`             | `DUAL_APPROVAL` READ                                                               |
| GET    | `/api/v1/core/approval-requests/policy`      | `DUAL_APPROVAL` READ                                                               |
| GET    | `/api/v1/core/approval-requests/:id`         | `DUAL_APPROVAL` READ                                                               |
| POST   | `/api/v1/core/approval-requests/:id/resolve` | `DUAL_APPROVAL` UPDATE + validación de `approverRoles` y segregación en el service |

## Agregar una operación nueva

1. Entrada en `DUAL_APPROVAL_OPS` (`src/shared/constants/dual-approval.ts`): `label`, `approverRoles`,
   `notificationType`, `entityType`, `entityTable`, `condition` (`always`/`threshold`), `ttlHours`
   (y `thresholdField`/`thresholdConfigKey`/`thresholdDefault` si es condicional).
2. Handler en `dual-approval.bootstrap.ts`: `DualApproval.register('OP_KEY', onApprove, onReject?)`
   delegando en el método de service existente.
3. Gatear: `gate('OP_KEY', {...})` en el service **o** middleware en la ruta (`require('OP_KEY', {...})`).
4. `annotatePending` + `pendingApproval` en el DTO del listado correspondiente (si aplica).
5. Tipo de notificación (seeder), audit actions y, si aplica, trigger de alerta.
6. RBAC: dar `RBAC_MODULES.DUAL_APPROVAL` (READ/UPDATE) al rol checker.

## Reglas

- ❌ Nunca desactivar el framework: no hay flag, y comentar el registro rompe el arranque.
- ✅ El handler `onApprove`/`onReject` delega en el método de service ya existente (sin duplicar lógica) y
  es **idempotente**.
- ✅ Segregación obligatoria: `second_approver_id !== requested_by`. Inmutabilidad: un request
  resuelto/expirado no se re-resuelve.
- ✅ Worker de expiración registrado en `base.server.ts` (cron diario).
