# Principios SOLID en la plantilla

> Qué principio se aplica, **dónde** está en el código y **cómo** seguirlo al crear un feature nuevo.
> La arquitectura sigue siendo **modular por capas** (`routes → controllers → services → repositories → Prisma`).
> SOLID no cambia esa arquitectura: la deja lista para migrar a hexagonal/clean si el dominio lo pide
> (ver [§ Camino a hexagonal](#camino-a-hexagonal)).

| Principio | Idea en una línea | Dónde se ve en la plantilla |
|---|---|---|
| **S** — Single Responsibility | Una clase, una razón de cambio | Fachadas `auth-login/`, `auth-register/`, `mfa/`, `admin-user/`, `admin-person/`; servicios compartidos de sesión y política |
| **O** — Open/Closed | Extender sin modificar | Canales de notificación como descriptores |
| **L** — Liskov Substitution | Un hijo sirve donde se espera al padre | `PrismaRepository` (todos los repos); cada repo expone solo lo que su tabla admite |
| **I** — Interface Segregation | No depender de métodos que no usas | Repos con métodos de negocio; puertos `XRepositoryPort` + `Pick` |
| **D** — Dependency Inversion | Depender de abstracciones inyectadas | `constructor(deps = {})`, `UnitOfWork`, el cliente de Prisma solo en repositorios |

Las reglas se **verifican automáticamente** en `tests/unit/guards/solid-architecture.test.ts`
(ver [§ Cómo se verifica](#cómo-se-verifica)).

---

## S — Single Responsibility

**Antes:** `auth-login.service.ts` tenía ~1600 líneas (login, MFA, refresh, logout, dispositivos,
sesiones) y `admin-person.service.ts` ~1000. Cualquier cambio en sesiones obligaba a tocar el archivo del login.

**Ahora:** cada responsabilidad vive en su propio service y el original queda como **fachada**:

```
src/modules/iam/services/
├── auth-login.service.ts                 ← fachada: flujo de login + delegación
└── auth-login/
    ├── token-refresh.service.ts          ← rotación de refresh / reuse attack
    ├── auth-logout.service.ts            ← logout / logoutAll
    ├── trusted-device-management.service.ts
    ├── session-control.service.ts        ← cierre selectivo y límite de sesiones
    ├── login-device.service.ts           ← dispositivo durante el login
    ├── sms-login-challenge.service.ts    ← MFA por SMS en el login
    ├── login-policy-gate.service.ts      ← política de privacidad al iniciar sesión (también biométrico)
    └── session-issuer.service.ts         ← tokens + JTI + user_session (también biométrico y registro)

src/modules/iam/services/
├── mfa.service.ts                        ← fachada: estado, método preferido, validar contraseña
└── mfa/
    ├── totp-mfa.service.ts               ← setup / activación / verificación / baja TOTP
    ├── sms-mfa.service.ts                ← código de activación / confirmación / baja SMS
    └── mfa-account.ts                    ← lecturas del usuario + bitácora de cambios de MFA

src/modules/iam/services/
├── auth-register.service.ts              ← registro (crea persona/contacto/usuario/consentimientos)
├── auth-register/
│   └── credential-reset.service.ts       ← reset de contraseña / MFA por enlace de un solo uso
└── auth-biometric.service.ts             ← enrolamiento + login biométrico (delegando sesión,
                                            política y criptografía en servicios compartidos)

src/modules/person/                       ← ya en Clean Architecture (docs/CLEAN-ARCHITECTURE.md): un caso
                                            de uso por acción en application/use-cases/ y las reglas
                                            ("cuenta eliminada es intocable", baja, nombres) en domain/

src/modules/iam/services/
├── admin-user.service.ts                 ← fachada (usuarios internos)
└── admin-user/
    ├── internal-user-query.service.ts    ← listados, detalle, roles, sesiones, bitácora
    ├── internal-user-profile.service.ts  ← alta y edición
    ├── internal-user-access.service.ts   ← rol (doble aprobación), estado, cierre de sesiones
    ├── internal-user-deletion.service.ts ← eliminación (re-auth + doble aprobación + ofuscación)
    └── internal-user-guards.ts           ← interno / superadmin / eliminado / invalidar sesiones

src/modules/approvals/services/
├── dual-approval.service.ts              ← motor: register / gate / resolve
└── dual-approval/
    └── dual-approval-notifier.service.ts ← avisos a aprobadores y al solicitante

src/shared/infrastructure/security/es256-signature.util.ts      ← verificación ES256 (pura), extraída de auth-biometric
```

La fachada mantiene **la misma API pública**, así controllers y tests no cambian:

```js
// auth-login.service.ts
refreshToken(refreshTokenStr) {
  return this.tokenRefresh.refreshToken(refreshTokenStr);
}
```

También se eliminó lógica **duplicada** entre los tres flujos de autenticación
(contraseña, biométrico, registro):

| Lógica | Estaba copiada en | Ahora vive en |
|---|---|---|
| Registro de consentimientos | `auth-login`, `auth-register`, `auth-biometric` | `schemas/records/legal/services/consent-recorder.service.ts` |
| Una sesión por dispositivo + límite de sesiones | `auth-login`, `auth-biometric` | `auth-login/session-control.service.ts` |
| Emisión de tokens + sesión | `auth-login`, `auth-biometric`, `auth-register` | `auth-login/session-issuer.service.ts` |
| Compuerta de política de privacidad | `auth-login`, `auth-biometric` | `auth-login/login-policy-gate.service.ts` |

**Regla práctica:** si un service supera ~400 líneas o su nombre necesita un "y" para describirlo
("login **y** sesiones **y** dispositivos"), se divide.

---

## O — Open/Closed

> Nota (2026-11-19): el envío se simplificó a una fila por canal en `notification_deliveries`
> (docs/notifications.md); desde la migración a Clean vive en
> `modules/notification/application/use-cases/deliveries.use-cases.ts`. El ejemplo queda como ilustración del principio.

**Antes:** `notification-sending.service.ts` repetía en tres lugares:

```js
if (category?.supports_push ?? true) { ... }
if (category?.supports_email ?? true) { ... }
if (category?.supports_sms ?? false) { ... }
```

Agregar WhatsApp obligaba a modificar los tres bloques.

**Ahora:** cada canal es un **descriptor** y el service los recorre:

```js
{
  key: 'sms',                 // define sms_sent / sms_error, supports_sms, allow_sms
  supportedByDefault: false,
  send: ctx => this.enviarSmsIndividual(ctx.userId, ctx.body, ctx.metadata, ctx.notificationId),
  schedule: ctx => this.schedulerService.programarEnvioSms(ctx.notificationId, ctx.userPreference)
}
```

Agregar un canal = sumar un descriptor en `_defaultChannels()` (o inyectarlo con `deps.channels`).
El envío inicial, el reenvío programado y el cálculo de estado (`completed` / `partial_failure` /
`failed`) no se tocan. Hay un test con un canal WhatsApp de ejemplo.

Otro ejemplo que ya existía: el `ENTITY_REGISTRY` de `admin-session-trace.service.ts`.

---

## L — Liskov Substitution

Todos los repositorios extienden `PrismaRepository` (`src/shared/infrastructure/database/prisma.repository.ts`), que
no trae operaciones genéricas: da el cliente (`db()`, el de la transacción activa si la hay) y los
helpers de paginación y búsqueda. Cada repositorio declara **solo las operaciones que su tabla admite**,
así ningún hijo hereda un método que no puede cumplir:

```
PrismaRepository            → db(), independentDb(), paginationArgs(), searchWhere(), listQuery()
├── GenderRepository        → findById, exists, findAllPaginated
├── AuditLogRepository      → create + lecturas + purgeCreatedBefore   (append-only: sin update/delete)
└── …
```

`AuditLogRepository` no tiene `update`/`delete` (y la base lo refuerza con un trigger). Con una clase
base genérica, el hijo los sobrescribía para lanzar error: no podía reemplazar al padre.

`RolePermissionOverrideRepository` verifica duplicados con `existsOverride(roleName, moduleName,
action)` en vez de redefinir un `exists(criteria)` genérico con otra firma.

**Regla práctica:** un override debe aceptar los mismos argumentos que el padre y no lanzar
errores que el padre no lanza. Si un hijo "no puede" hacer algo del padre, la jerarquía está mal.
Si necesitas otra semántica, usa otro nombre en vez de redefinir el método del padre.

---

## I — Interface Segregation

1. **Cada repositorio declara sus operaciones** (arriba): uno de solo inserción no carga con `update`/`delete`.
   Los services dependen de `XRepositoryPort` + `Pick` con los métodos que usan (`src/modules/repository-ports.ts`).
2. **Métodos con nombre de negocio** en vez de un `findAll(where)` genérico que obliga al service a
   conocer el ORM (los "antes" son de la época de Sequelize):

| Antes (en el service) | Ahora |
|---|---|
| `roleRepository.findAll({ name: { [Op.in]: CLIENT_ROLE_NAMES } })` | `roleRepository.findByNames(CLIENT_ROLE_NAMES)` |
| `{ name: { [Op.in]: A, [Op.notIn]: B } }` | `roleRepository.findByNames(A, { exclude: B })` |
| `repo.findAll({ [pk]: { [Op.in]: ids } })` | `repo.findByIds(ids, pk)` |
| `bulkUpdate(..., { notification_id: { [Op.in]: ids } })` | `notificationRepository.markAsReadByIds(ids)` |
| `_buildWhere(query)` con `Op.gte` / `Op.lte` | `auditLogRepository.searchPaginated(query, ...)` |
| `{ created_at: { [Op.between]: [from, to] } }` | `auditLogRepository.findAuthAttemptsPaginated(criteria, ...)` |
| `include: [{ model: UserTrustedDevice, as: 'device' }, { model: User, ... }]` | `userSessionRepository.findPaginatedWithDeviceAndUser(where, pagination)` |
| `_includeExecutor()` con `model: User` / `model: Person` | inclusión por defecto de `auditLogRepository.searchPaginated` / `findByIdFull` |
| `findByEmail(email, { include: [...] })` en el reset | `personContactRepository.findByEmailWithUser(email)` |

---

## D — Dependency Inversion

### 1. Inyección por constructor

Todos los services de clase reciben sus dependencias volátiles (repositorios, otros services,
storage, transacciones) por constructor, con la implementación real como default:

```ts
class PersonReferenceService {
  constructor(deps = {}) {
    this.personReferenceRepository = deps.personReferenceRepository ?? personReferenceRepository;
  }

  async list(personId, userId) {
    const references = await this.personReferenceRepository.findAllByPersonId(personId); // ← this., no el import
    // ...
  }
}

export default Object.assign(new PersonReferenceService(), { PersonReferenceService }); // instancia (controllers) + clase (tests, composición)
```

Eso permite testear **sin `jest.mock`**:

```ts
import personReferenceServiceModule from '.../person-reference.service';
const { PersonReferenceService } = personReferenceServiceModule;
const service = new PersonReferenceService({ personReferenceRepository: { findAllByPersonId: jest.fn() } });
```

Ejemplos reales: `consent-recorder.service.test.ts` y `unit-of-work.test.ts`. En los módulos ya migrados a Clean
el mismo principio va más lejos: los casos de uso reciben puertos y se prueban con dobles en memoria
(`tests/doubles/`).

> Nota: los utils puros o transversales (`AppError`, `logger`, `pageMetadata`, DTOs) se siguen
> importando directo. DIP apunta a las dependencias que **cambian o tocan infraestructura**.

### 2. Unit of Work

Los services no abren transacciones del ORM. Usan el puerto `src/shared/infrastructure/database/unit-of-work.ts`, siempre
en modo gestionado: lo que pasa dentro de `run()` se confirma junto o se revierte junto, y lo posterior al
commit (auditoría, notificaciones) va **después**, fuera de la transacción:

```ts
const user = await this.unitOfWork.run(async () => {
  const user = await this.userRepository.update(id, data); // los repositorios toman la transacción solos
  await this.personContactRepository.update(user.personId, contact);
  return user;
});
audit.record('USER_UPDATED', …);
```

`run()` abre una transacción interactiva de Prisma y la publica en `transaction-context`
(AsyncLocalStorage); `PrismaRepository#db()` la usa si está activa. No hay `begin()`/`commit()` manual:
con commit a mano, un error **después** del commit hacía `rollback()` sobre una transacción confirmada y
tapaba el error original.

### 3. La capa de aplicación no conoce el ORM

Services, helpers, validators, controllers, middlewares y utils **no** usan el cliente de Prisma
(`src/shared/infrastructure/database/prisma`, `$queryRaw`, `$transaction`, delegates). Sí pueden importar **tipos** del cliente
generado (`import type { User } from '…/generated/prisma/client'`): son la forma de las filas.

- **Consultas e `include`** → métodos con nombre de negocio en el repositorio (tabla de § I).
- **Enums de dominio** → `src/shared/infrastructure/database/domain-enums.ts` (`NOTIFICATION_PROCESSING_STATUS`,
  `APPROVAL_REQUEST_STATUS`, `USER_SESSION_STATUS`, `INTEGRATION_PRODUCTS`, `INTEGRATION_RESULTS`).
  Toma los valores de los `enum` del schema de Prisma, con chequeo de exhaustividad: una sola fuente de verdad.
- **Código de `shared/`** que consulta la base (`auth.middleware`, `rbac.service`,
  `mfa-status.util`, `resilience-config.util`) pasa por repositorios cargados de forma diferida.
  `require` diferido porque esos módulos se cargan al arrancar y un import directo crearía un ciclo.
- **Clientes de infraestructura** (SNS, S3) se inyectan: `new SnsPushGateway(snsClient)`,
  `new SnsSmsGateway(attempts, snsClient)`, `fileStorage` en banners.

**Excepciones deliberadas** (adaptadores de infraestructura, fuera de la regla):

| Dónde | Por qué |
|---|---|
| `src/shared/infrastructure/observability/logger.util.ts` | Escribe los logs a través de su repositorio, cargado de forma diferida (todo el sistema depende del logger). |
| `audit-archive.worker.ts` | Purga lotes de `audit_logs` con `auditLogRepository.purgeCreatedBefore` (mantenimiento, no lógica de negocio). |
| `shared/base/*`, `servers/*`, `*.bootstrap.ts` | Arranque y composición. |

---

## Checklist para un feature nuevo

- [ ] El service recibe repos/colaboradores por `constructor(deps = {})` y los usa vía `this.`.
- [ ] Exporta la instancia **y** la clase.
- [ ] No usa el cliente de Prisma: si necesitas un filtro o un `include`, agrega un método con nombre de
      negocio al repositorio (los tipos de las filas sí, con `import type`).
- [ ] Enums (estados, catálogos) desde `src/shared/infrastructure/database/domain-enums.ts`.
- [ ] Transacciones con `this.unitOfWork.run(async () => …)`: los repositorios toman la transacción solos.
- [ ] El repositorio extiende `PrismaRepository` y expone solo las operaciones que su tabla admite.
- [ ] Si el service crece y mezcla responsabilidades, se divide y el original queda como fachada.
- [ ] Antes de copiar lógica de otro flujo, revisa si ya hay un servicio compartido
      (`session-issuer`, `session-control`, `login-policy-gate`, `consent-recorder`).
- [ ] Variantes que van a crecer (canales, proveedores, tipos) → registro/estrategia, no `if` encadenados.
- [ ] `npm test` en verde, incluida la guarda `tests/unit/guards/solid-architecture.test.ts`.

Las plantillas de código actualizadas están en [`implementation-patterns.md`](implementation-patterns.md).

---

## Cómo se verifica

`tests/unit/guards/solid-architecture.test.ts` analiza el código fuente (sin cargarlo) y falla si:

| Regla | Principio |
|---|---|
| Algún archivo del proyecto importa `sequelize` | D |
| Fuera de repositorios y `shared/database` se importa (como valor) el cliente de Prisma | D |
| La capa de aplicación arma consultas de Prisma (`$queryRaw`, `$transaction`, `prisma.x.find…`) | I / D |
| Los enums generados se leen fuera de `src/shared/infrastructure/database/domain-enums.ts` | D |
| Un service arma `include` con `model: X` | D |
| Un repositorio no extiende `PrismaRepository` | L |
| Un service exporta la instancia sin exportar también la clase | D |
| Un service importa repositorios sin recibirlos por `constructor(deps = {})` | D |

Si falla, la corrección casi siempre es mover la consulta, el enum o el `include` a su lugar. No se
arregla relajando la guarda.

Lo que la guarda **no** puede medir (y queda a criterio de revisión): si un service mezcla
responsabilidades. Como referencia, ninguno pasa de ~600 líneas y los que superan 400
(`auth-login`, `auth-biometric`, `dual-approval`, `profile`, `auth-register`, `person-credentials`) tienen una sola razón de cambio.

---

## Camino a hexagonal

Con lo anterior, pasar a hexagonal es sobre todo **mover y renombrar**:

| Hoy (capas + SOLID) | Hexagonal |
|---|---|
| Sub-services de una fachada (`token-refresh.service.ts`) | `application/use-cases/` |
| Contrato implícito del repositorio (`findByNames`, `findActive`) | `domain/ports/*.ts` (interfaces) |
| Repositorios (`extends PrismaRepository`) | `infrastructure/adapters/prisma/` |
| `UnitOfWork` | Puerto `UnitOfWork` + adaptador Prisma (ya está separado) |
| `export default Object.assign(new X(), { X })` con defaults | *Composition root* que arma todo en un solo lugar |

Lo que faltaría: definir los puertos de forma explícita (en TypeScript serían `interface`) y
crear el composition root. Los `include` ya viven en los repositorios.
