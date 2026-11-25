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

> ❌ Nunca "comentar" `src/shared/domain/constants/dual-approval.ts` para desactivar: el dominio de approvals y las
> rutas lo requieren al arrancar y el server no levantaría.

## Las piezas

El módulo `src/modules/approvals/` está en Clean Architecture (ver `docs/CLEAN-ARCHITECTURE.md`):

| Pieza | Archivo |
| --- | --- |
| Registro declarativo (`DUAL_APPROVAL_OPS`, `WILDCARD_ROLES`, `CONDITION`) | `src/shared/domain/constants/dual-approval.ts` |
| Reglas: condición, umbral, vencimiento en horas hábiles, quién resuelve, bypass de super_admin; la solicitud | `domain/dual-approval-operation.ts`, `domain/approval-request.ts`, `domain/business-hours.ts` |
| Casos de uso | `application/use-cases/` (`GateOperation`, `ResolveApprovalRequest`, `ListApprovalRequests`, `GetApprovalRequest`, `GetApprovalPolicy`, `FindPendingApprovals`, `ExpireApprovalRequests`) |
| Reanudaciones (IoC) | `application/use-cases/approval-handlers.ts` (`ApprovalHandlers`) |
| Tabla + worker | `infrastructure/persistence/prisma-approval-request.repository.ts`, `infrastructure/workers/dual-approval-expiration.worker.ts` |
| Endpoints admin + middleware de ruta | `presentation/http/` (`approval-request.routes.ts`, controller, `dual-approval.middleware.ts`) |
| Composición | `approvals.module.ts` (`createApprovalsModule`); lo conecta `src/main/container.ts` |

Los aprobadores (usuarios activos con un rol, de iam) y el umbral configurado (settings) llegan por los puertos
`ApproverDirectory` y `ApprovalThresholds`: `src/main/adapters/approval-sources.adapter.ts`. El schema Swagger
`PendingApproval` vive en `src/main/swagger/schemas/core.schema.ts` (compartido admin+client).

## API del módulo

```ts
handlers.register(opKey, onApprove, onReject?)   // container: la acción real al aprobar (IoC)
useCases.gate.execute(opKey, { entityType, entityId, payload, ctx })
   // -> { pending:false } si no requiere (ejecuta directo). 'always' ⇒ requiere; 'threshold' ⇒ payload[thresholdField] > umbral
   // -> { pending:true, request } si requiere: crea approval_request, calcula expires_at (horas
   //    hábiles), avisa a los approverRoles (setImmediate), audita DUAL_APPROVAL_REQUESTED
   // -> 409 (DUAL_APPROVAL_ALREADY_PENDING) si ya hay una pendiente para (operation_key, entity_id)
   // -> super_admin: { pending:false, autoApproved:true, request } (ver bypass abajo)
ResolveApprovalRequest.execute({ approvalRequestId, decision, notes, ctx })      // POST .../resolve
   // valida status===pending, rol ∈ approverRoles ∪ WILDCARD_ROLES, approver !== requested_by
   // approve -> onApprove(payload, ctx); status=approved; result; audita DUAL_APPROVAL_APPROVED
   // reject  -> onReject(payload, ctx) si existe; status=rejected; audita DUAL_APPROVAL_REJECTED
useCases.findPending.execute(entityType, ids)    // Map id → pendingApproval (1 query batch)
requireDualApproval('OP_KEY', options)           // el gate como middleware de ruta
expirationWorker.start()                         // cron diario: vence las pendientes (ExpireApprovalRequests)
```

iam usa el gate y el badge por su puerto `DualApproval` (`gate` y `findPending`), que conecta
`src/main/adapters/iam-sources.adapter.ts` con estos casos de uso.

### Bypass por rol — `super_admin`

Única excepción real a "cuatro ojos siempre": el gate detecta al superadmin (`isSuperAdmin`, contra
`SUPERADMIN_ROLE_NAMES`), crea igual la solicitud pero ya **`approved` por el propio maker**
(`requested_by === second_approver_id`, traza completa) y devuelve `{ pending:false, autoApproved:true,
request }`, **sin** invocar el handler — la acción corre inline en el mismo request (el flujo normal la
ejecuta una sola vez). Audita `DUAL_APPROVAL_REQUESTED` + `DUAL_APPROVAL_AUTO_APPROVED`.

> En el template base, `SUPERADMIN` omite el gate; `ADMIN` **sí** está sujeto a doble aprobación. Ver
> `docs/rbac/rbac.md`.

## Dos formas de gatear (ambas terminan en el handler registrado)

- **Middleware de ruta** `requireDualApproval('OP_KEY', { shouldGate?, extractPayload?, extractEntity? })`
  (lo entrega `approvals.module.ts`) → operaciones cuyo disparo se decide con `req.body`/`req.params`. Si la op
  queda pendiente responde `202` y NO llama al controller. `shouldGate(req)` permite gatear solo el caso
  sensible en endpoints multipropósito.
- **Gate en el caso de uso** (`GateOperation`, por un puerto del módulo que gatea, p. ej. `DualApprovalGate` de
  person) → cuando la condición se calcula a mitad del flujo. Las 3 operaciones del template gatean así.

## Reanudación = handler (IoC), no se re-ejecutan requests

El handler y el controller "normal" delegan en **el mismo caso de uso (o método de service)** → la lógica no se
duplica; solo hay dos puntos de entrada (ejecución directa vs. tras aprobación). El handler debe ser
**idempotente** (puede reintentarse). Los registra `src/main/container.ts` al armar los módulos
(`approvals.handlers.register(...)`); los de iam están en `src/main/adapters/approval-sources.adapter.ts`.

## Operaciones gateadas (3)

El registro (`DUAL_APPROVAL_OPS`) trae, en el template base, **tres** operaciones — todas `condition:
always`, todas sobre la entidad `User`/`users`, con `approverRoles: ['ADMIN']` y `ttlHours: 72`:

| `operation_key`        | Qué gatea                                    | Handler                                          | Gate       |
| ---------------------- | -------------------------------------------- | ------------------------------------------------ | ---------- |
| `RBAC_ROLE_CHANGE`     | Cambio de rol de un usuario interno          | `AdminUserService.executeChangeRole` (iam)       | servicio   |
| `CLIENT_ACCOUNT_DELETE`| Eliminación de cuenta de cliente (irreversible) | `ExecuteClientAccountDeletion` (person)       | caso de uso |
| `INTERNAL_USER_DELETE` | Eliminación de usuario interno (irreversible)| `AdminUserService.executeDeleteUser` (iam)       | servicio   |

- Los tres avisan a los aprobadores con el tipo de notificación `RBAC_SECOND_APPROVER`; al resolverse,
  el maker recibe `DUAL_APPROVAL_RESOLVED`.
- Ninguna registra hoy `onReject` (el framework lo soporta): el rechazo solo cierra el `approval_request`,
  sin acción de dominio que deshacer.
- **Roles aprobadores:** `approverRoles = ['ADMIN']`; los **wildcard** (`SUPERADMIN`, `ADMIN`) siempre
  pueden resolver. La segregación (`second_approver_id !== requested_by`) impide que el maker se apruebe
  a sí mismo aunque tenga el rol.

> El framework soporta `condition: threshold` (umbral sobre un campo del payload, con override en
> `SystemGlobalConfig` vía `thresholdConfigKey` —el puerto `ApprovalThresholds`— y `thresholdDefault`), pero **ninguna operación del
> template lo usa** hoy. Es el gancho para cuando derives un dominio con montos/límites.

## Contrato con el front

- Operación gateada pendiente → **`202 Accepted`** con el `approval_request` (usar `ApiResponse.accepted`).
- `GET /api/v1/core/approval-requests/policy` → qué operaciones están gateadas + `enabled: true`.
- En los **listados** de módulos gateados se anotan las pendientes (`FindPendingApprovals`; iam: `annotatePending(entityType, rows, idField)`) y el DTO
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
| POST   | `/api/v1/core/approval-requests/:id/resolve` | `DUAL_APPROVAL` UPDATE + validación de `approverRoles` y segregación en el caso de uso |

## Agregar una operación nueva

1. Entrada en `DUAL_APPROVAL_OPS` (`src/shared/domain/constants/dual-approval.ts`): `label`, `approverRoles`,
   `notificationType`, `entityType`, `entityTable`, `condition` (`always`/`threshold`), `ttlHours`
   (y `thresholdField`/`thresholdConfigKey`/`thresholdDefault` si es condicional).
2. Handler en `src/main/container.ts`: `approvals.handlers.register('OP_KEY', onApprove, onReject?)`
   delegando en el caso de uso (o método de service) existente.
3. Gatear: `GateOperation` por un puerto del módulo que gatea **o** middleware en la ruta (`requireDualApproval('OP_KEY', {...})`).
4. `FindPendingApprovals` + `pendingApproval` en el DTO del listado correspondiente (si aplica).
5. Tipo de notificación (seeder), audit actions y, si aplica, trigger de alerta.
6. RBAC: dar `RBAC_MODULES.DUAL_APPROVAL` (READ/UPDATE) al rol checker.

## Reglas

- ❌ Nunca desactivar el framework: no hay flag, y comentar el registro rompe el arranque.
- ✅ El handler `onApprove`/`onReject` delega en el caso de uso ya existente (sin duplicar lógica) y
  es **idempotente**.
- ✅ Segregación obligatoria: `second_approver_id !== requested_by`. Inmutabilidad: un request
  resuelto/expirado no se re-resuelve.
- ✅ Worker de expiración (`container.approvals.expirationWorker`) iniciado por `src/main/server.ts` (cron diario).
