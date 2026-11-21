# Auditoría, operaciones y logs

Tres registros distintos, cada uno con su trabajo. Todos comparten el mismo `correlationId`, el id de la
operación en curso.

| | Auditoría | Traza de operaciones | Logs |
|---|---|---|---|
| Responde | ¿Qué hecho de negocio ocurrió y quién lo hizo? | ¿Qué operación corrió, cuánto tardó, cómo terminó? | ¿Qué pasó por dentro, paso a paso? |
| Se escribe con | `audit.record(...)` | automático (`operationMiddleware` / `runOperation`) | `logger.info/warn/error(...)` |
| ¿Se puede perder? | No: va en la transacción | Tolerable | Tolerable |
| Retención | Años (SFC: 5) | `OPERATIONS_RETENTION_DAYS` (90) | la del destino (CloudWatch) |
| Dónde | `audit_logs` → S3 | `operations` | consola (JSON en producción) |

## Operaciones (`src/shared/infrastructure/observability/operation.ts`)

Toda operación entra por un único punto:

- **HTTP / webhooks**: `operationMiddleware`, el primer middleware de la app. Genera el id (siempre el
  servidor; el `X-Correlation-Id`/`X-Request-Id` del cliente se guarda aparte como `client_request_id`),
  lo devuelve en `X-Correlation-Id`, publica el contexto en AsyncLocalStorage y deja la fila en
  `operations`. Las rutas de webhooks se marcan con `markOperationSource('webhook')`.
- **Workers y tareas de sistema**: `runOperation({ source: 'worker' | 'system', name }, fn)`.

```ts
cron.schedule(CRON, () =>
  runOperation({ source: 'worker', name: 'notification.email-retry' }, () => retryFailedEmails())
);
```

Cada operación inserta su fila al empezar (`running`) y la cierra al terminar (`success` | `failure`,
duración, status HTTP, error). Si el proceso muere a mitad, la fila queda en `running`: es la evidencia.
Un worker que falla **no** tumba el proceso: queda en `failure`, se loguea y se audita
`WORKER_CYCLE_FAILED` (con alerta). Una tarea de sistema que falla relanza el error.

No dejan fila: `/health`, `/` y los assets de Swagger.

**Consulta (admin, permiso `globalLogs`)**:
- `GET /admin/api/v1/records/audit/operations`: listado con filtros por origen, estado, usuario, nombre
  y fechas.
- `GET /admin/api/v1/records/audit/operations/:operationId`: línea de tiempo. Une la operación, sus
  operaciones hijas y sus hechos de auditoría, y trae la consulta de CloudWatch Logs Insights con los
  logs paso a paso (incluida una línea por cada llamada a un proveedor externo).

## Auditoría (`src/modules/audit`)

```ts
import auditModule from '../../audit';
const { audit } = auditModule;

await audit.record('PERSON_ROLE_CHANGED', {
  actorId: adminUserId,
  entityType: 'User',
  entityTable: 'users',
  entityId: userId,
  details: { before: { role: 'auditor' }, after: { role: 'admin' } }
});
```

- **La acción es una clave del catálogo** (`src/modules/audit/catalog/`): un typo no compila. Cada acción
  define su descripción, categoría y riesgo, y si dispara una alerta (`alert: true`).
- **Quién, desde dónde y en qué operación** (IP, user-agent, sesión, correlationId, origen) sale solo del
  contexto de la operación: no se pasa por parámetro.
- **Se escribe dentro de la transacción en curso** (unit of work): el cambio y su auditoría quedan juntos
  o ninguno. Los **intentos fallidos** (`outcome` distinto de `success`) se escriben aparte, porque esa
  transacción se va a revertir y el intento tiene que quedar. Fuera de una transacción, si la escritura
  falla se reporta en el log y el flujo sigue (el cambio ya está hecho).
- **Alertas**: si la acción tiene `alert: true`, el mismo `record` crea su fila en `audit_alerts`,
  enlazada al registro.

La auditoría registra **hechos de negocio**. Los errores de una petición van al log y a `operations`; de
ellos solo se auditan los rechazos de seguridad (401 → `AUTH_FAILURE`, 403 → `ACCESS_DENIED`).

### Agregar una acción

En el archivo del catálogo que corresponda (`audit-actions.<dominio>.ts`):

```ts
PERSON_ROLE_CHANGED: {
  alert: true, // opcional
  description: 'Rol de un usuario modificado por administrador',
  category: AUDIT_CATEGORIES.PERSONS,
  risk: AUDIT_RISKS.HIGH
},
```

### Bitácora de cambios de la cuenta

Cada cambio de un dato de la cuenta (email, contraseña, MFA, estado, rol, documento…) es un registro
`USER_FIELD_CHANGED`, con `changeType`, `previousValue` y `newValue` en `details`:

```ts
await audit.recordChange({ userId, changedByUserId: adminId, changedByRole: 'admin', changeType: 'email', previousValue, newValue });
```

Las vistas de bitácora (admin, usuario interno y feed de actividad del cliente) leen de `audit_logs` a
través de `change-log.repository`. Los valores se enmascaran al responder (`previousValue`/`newValue`).

### Eventos de infraestructura

`shared/` no importa módulos, pero algunos eventos suyos se auditan (worker caído, Redis, 401/403). Los
publica con `auditInfraEvent(...)` (`src/shared/infrastructure/observability/audit-hook.ts`) y `src/main/app.ts` los conecta
al módulo de auditoría con `registerAuditSink`.

### Retención y archivado (`audit-archive.worker`)

- **Diario 02:15 UTC**: exporta a S3 el día anterior completo, un JSONL por día
  (`audit-logs/AAAA/MM/DD.jsonl`, clase STANDARD_IA). Reexportar un día es seguro: sobrescribe.
- **Diario 03:30**: purga las operaciones más viejas que `OPERATIONS_RETENTION_DAYS`.
- **Mensual**: aviso de registros próximos a vencer el período caliente; la purga de `audit_logs` solo
  corre si el Superadmin la habilitó (`audit_hot_purge_enabled`). `audit_logs` es append-only: un
  trigger rechaza UPDATE/DELETE salvo la purga autorizada.

## Logs (`src/shared/infrastructure/observability/logger.util.ts`)

Winston. En producción, la consola va en JSON (CloudWatch Logs Insights filtra por `correlationId`); en
el resto, legible y con colores. El `correlationId` de la operación en curso se agrega solo a cada línea.
Los campos sensibles (password, token, email, documento…) se redactan.

Para reconstruir una operación paso a paso:

```
fields @timestamp, level, message | filter correlationId = "<operationId>" | sort @timestamp asc
```
