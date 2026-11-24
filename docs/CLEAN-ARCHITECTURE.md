# Clean Architecture

Este repositorio es la versión **Clean Architecture** de [plantilla-base](https://github.com/spudy101/base-project)
(misma API, mismas funcionalidades). Este documento explica cómo está organizado y dónde va cada cosa.
Si el código lo contradice, falla un test: `tests/unit/guards/clean-architecture.test.ts`.

> **Estado de la migración:** `shared/` ya está repartido en capas; `settings`, `catalogs`, `banners`, `legal`,
> `integration`, `audit` y `person` están migrados completos (moldes: escritura, solo lectura, agregado + archivos
> en S3, un módulo que otros usan, uno que reacciona a eventos de infraestructura, uno del que dependen todos y
> uno que trabaja sobre los datos de otro).
> Los demás módulos siguen con
> la estructura en capas de la plantilla original y se migran uno por uno. Ver
> [§ Estado y siguientes pasos](#estado-y-siguientes-pasos).

## La idea en una frase

**El negocio no depende de los detalles.** Las reglas (dominio) y los casos de uso no saben que existen
Prisma, Postgres, Express, Redis ni AWS. Los detalles dependen del negocio, nunca al revés.

```
         ┌───────────────────────────────────────────────┐
         │  presentation          infrastructure         │   ← detalles (Express, Prisma, AWS, Redis)
         │  (rutas, controllers)  (repos Prisma, SDKs)   │
         │       ┌───────────────────────────────┐       │
         │       │  application                  │       │   ← casos de uso + puertos (interfaces)
         │       │       ┌───────────────┐       │       │
         │       │       │    domain     │       │       │   ← entidades, value objects, errores
         │       │       └───────────────┘       │       │
         │       └───────────────────────────────┘       │
         └───────────────────────────────────────────────┘
              Las flechas de import siempre apuntan HACIA ADENTRO.
```

## Estructura

```
src/
  main/                    composition root: el único lugar que conecta todo
    container.ts             crea cada módulo y le pasa sus dependencias (los `new` viven acá)
    adapters/                implementan puertos con otros módulos (auditoría → audit, avisos → notification)
    app.ts                   Express: middlewares globales + monta los routers
    server.ts                arranque, workers y apagado ordenado
    swagger/                 documentación OpenAPI de toda la API

  modules/<dominio>/       un módulo por dominio de negocio
    domain/                  entidades, value objects y errores del dominio (TypeScript puro)
    application/
      ports/                 interfaces que el módulo NECESITA (repositorios, gateways) → *.port.ts
      use-cases/             una clase por acción del sistema (GetX, UpdateX…) con `execute()`
      dto/                   lo que entra y sale de los casos de uso (datos planos)
    infrastructure/
      persistence/           repositorios Prisma que implementan los puertos + mappers fila ↔ entidad
      (providers/, workers/) integraciones externas y tareas periódicas, cuando el módulo las tenga
    presentation/
      http/                  rutas (factory), controller, requests/ y responses/ (Zod), docs/ (OpenAPI)
    <dominio>.module.ts      composición del módulo: crea adaptadores → casos de uso → controller → router
    index.ts                 API transitoria para los módulos aún no migrados

  shared/                  lo transversal, también en capas
    kernel/                  helpers puros sin dependencias (mensajes de error, concurrencia, interop)
    domain/                  DomainError y sus tipos; constantes de negocio (RBAC, doble aprobación, PII)
    application/             puertos comunes (Logger, UnitOfWork, AuditTrail, Notifier, KeyValueCache), paginación
    infrastructure/          Prisma, unit of work, Redis, S3, callProvider + circuit breaker, JWT, cifrado,
                             logger, contexto de la operación, configuración de entorno
    presentation/            middlewares HTTP, AppError, respuestas, validación Zod, OpenAPI, guardas de ruta

tests/
  doubles/                 implementaciones en memoria de los puertos (para testear casos de uso)
  unit/guards/             la arquitectura verificada por tests
```

## Qué va en cada capa

| Capa | Contiene | Puede importar | NO puede importar |
|---|---|---|---|
| **domain** | Entidades con sus reglas, value objects inmutables, errores del dominio | `domain` propio, `shared/domain`, `shared/kernel` | Nada más. Ni paquetes npm |
| **application** | Casos de uso, puertos (interfaces), DTOs de entrada/salida | lo anterior + `application` propio y `shared/application` | Prisma (ni `import type`), Express, AWS, otros módulos, paquetes npm |
| **infrastructure** | Adaptadores: repos Prisma, mappers, clientes de proveedores, workers | lo anterior + `shared/infrastructure`, paquetes npm | `presentation` |
| **presentation** | Rutas, controllers, esquemas Zod de request/response, docs OpenAPI | `application` propio, `shared/{domain,application,presentation}`, paquetes npm | `infrastructure` (propia o compartida) |
| **`<dominio>.module.ts`** | La composición del módulo | Todas las capas del módulo y `shared/` | Otros módulos |
| **src/main/** | Composition root, adaptadores entre módulos, app y server | Todo | — |

Un módulo en Clean **no importa ningún otro módulo**. Si necesita auditar, notificar o saber quién es el
usuario, declara un puerto y `src/main/` le pasa la implementación.

## Recorrido de una petición (settings)

`PATCH /admin/api/v1/core/system-config` con `{ "integrationResilience": { "maxRetries": 4 } }`:

```
presentation/http/system-global-config.routes.ts   guards.authenticate → RBAC → rate limit → validate(Zod)
        │
presentation/http/system-global-config.controller.ts   req.body → { actorId, patch }
        │
application/use-cases/update-system-global-config.use-case.ts
        │  configs.findActive()                ← puerto SystemGlobalConfigRepository
        │  current.changesFor(patch)           ← regla del DOMINIO: merge parcial de la resiliencia
        │  configs.applyChanges(id, changes)   ← puerto (la versión sube de forma atómica)
        │  audit.record(...)                   ← puerto AuditTrail
        │  notifier.notify(...)                ← puerto Notifier
        │  return toSystemGlobalConfigOutput(updated)   ← DTO de salida
        │
infrastructure/persistence/prisma-system-global-config.repository.ts   implementa el puerto con Prisma
infrastructure/persistence/system-global-config.mapper.ts              entidad (camelCase) ↔ JSONB (snake_case)
```

¿Y quién conecta todo eso? `settings.module.ts`:

```ts
export function createSettingsModule({ audit, notifier, logger, guards }: SettingsModuleDeps) {
  const configs = new PrismaSystemGlobalConfigRepository();                 // adaptador
  const getSystemGlobalConfig = new GetSystemGlobalConfig(configs, audit);  // casos de uso
  const updateSystemGlobalConfig = new UpdateSystemGlobalConfig(configs, audit, notifier, logger);
  const controller = new SystemGlobalConfigController(getSystemGlobalConfig, updateSystemGlobalConfig);
  return { adminRouter: createSystemGlobalConfigRouter(controller, guards), useCases: { … } };
}
```

Y `src/main/container.ts` le pasa los adaptadores de los otros módulos:

```ts
const audit = createAuditModule({ … });   // primero: su `trail` (AuditTrail) lo usan todos
const settings = createSettingsModule({ audit: audit.trail, notifier: notifierAdapter, logger, guards: routeGuardsAdapter });
```

## Un módulo de solo lectura (catalogs)

`catalogs` muestra datos de referencia (países, ciudades, géneros, tipos de documento…) en rutas públicas.
Casi no tiene reglas, y eso también se modela:

- **Dominio:** `domain/catalog-entries.ts` son modelos de solo lectura (sin comportamiento). Lo que SÍ es
  regla, como reconocer una ciudad o un prefijo a partir del texto de un tercero, está en
  `domain/location-names.ts` como funciones puras. El repositorio trae las ciudades y el dominio decide cuál
  coincide.
- **Un caso de uso genérico:** todos los catálogos se listan igual, así que `ListCatalog<Entry, Output>` es una
  sola clase. `catalogs.module.ts` crea una instancia por catálogo con su lector, su acción de auditoría y su
  forma de salida.
- **Datos de otros módulos:** roles (iam), tipos de notificación (notification) y política de privacidad
  (legal) son de otros módulos. Catalogs declara el puerto (`CatalogReader<RoleEntry>`…) y
  `src/main/adapters/catalog-sources.adapter.ts` lo implementa leyendo esos módulos. Catalogs no los importa.
- **Caché:** la política de privacidad se cachea 12 h a través del puerto `KeyValueCache` de
  `shared/application`. En producción es Redis; en los tests, un `Map`.

## Un módulo que otros usan (legal)

`legal` (tipos de consentimiento, políticas de privacidad y consentimientos otorgados) es el primero que
otros módulos necesitan para trabajar: iam deja constancia de lo que el usuario aceptó al registrarse o
iniciar sesión, person muestra los consentimientos en el perfil y audit los muestra en la traza de una sesión.

- **Reglas en las entidades:** `ConsentType` normaliza el código, pone los valores por defecto y decide qué
  cambia una edición parcial, si un consentimiento se puede revocar y si se puede exigir (la Ley 1581 prohíbe
  exigir uno opcional). `PrivacyPolicy.documentKey()` decide dónde vive el PDF de cada versión.
- **Lo que otros usan son casos de uso:** `GrantPrivacyPolicyConsent` y `GrantCommercialCommunicationsConsent`
  (antes un "ConsentRecorder" con repositorios concretos). `legal.module.ts` los devuelve en `useCases`.
  Mientras iam no esté migrado, los recibe por el `index.ts` transitorio.
- **Un módulo invalida lo que otro cachea:** al publicar una versión hay que borrar la política vigente que
  catalogs guarda en caché. Legal declara el puerto `ActivePrivacyPolicyCache` (`invalidate()`), y
  `src/main/adapters/privacy-policy-cache.adapter.ts` lo implementa con la clave de catalogs. Ninguno de los
  dos conoce al otro.
- **Un middleware que usa un caso de uso:** `requireConsent(code)` (presentation) llama a `VerifyConsent`
  (application). El módulo lo expone ya armado para usarlo en cualquier ruta.

## Un módulo que reacciona a la infraestructura (integration)

`integration` muestra el semáforo de los proveedores externos y el historial de sus caídas, y registra cada
caída cuando pasa. El que avisa es el circuit breaker de `shared/infrastructure`, que no conoce el negocio.

- **Reglas en el dominio:** `providerNameFor('ses')` → `aws_ses`, `FallbackEvent` (activa si no tiene fin,
  duración en segundos) y `availabilityOf(state)` (CLOSED → Disponible, HALF_OPEN → Degradado, OPEN → No
  disponible).
- **El breaker es un detalle detrás de dos adaptadores:** `CircuitBreakerStatusReader` implementa el puerto
  `CircuitStatusReader` (lo que lee el dashboard) y `fallback-circuit.listener.ts` convierte `onOpen`/`onClose`
  en los casos de uso `RecordFallbackOpened` y `RecordFallbackResolved`. El listener corre cada aviso como
  operación de sistema y nunca lanza (el breaker no debe fallar por no poder registrar la ventana).
  `integration.module.ts` lo devuelve como `circuitListener` y `src/main/app.ts` lo registra en el breaker.
- **Datos de otro módulo:** cuántos procesos fallaron durante la caída sale de los intentos de SMS de
  notification. Integration declara `FailedProcessCounter` y `src/main/adapters/failed-process-counter.adapter.ts`
  decide para qué productos se puede contar (hoy solo `aws_sms`).

## Un módulo del que dependen todos (audit)

`audit` registra los hechos de negocio de todos los módulos y además tiene su propia API de consulta (logs,
alertas, catálogo de acciones, bitácora de cambios, traza de sesiones y de operaciones, feed de actividad del
cliente) y un worker de retención.

- **La escritura es un caso de uso:** `RecordAuditEvent` clasifica el hecho con el catálogo
  (`domain/catalog`, que es dominio: la taxonomía de la auditoría), toma quién/desde dónde del puerto
  `OperationContext`, decide si se escribe dentro de la unidad de trabajo o aparte (un intento fallido debe
  quedar) y si dispara una alerta. `audit.module.ts` lo entrega como `trail` (el puerto `AuditTrail` de
  `shared/application`); `src/main/container.ts` crea audit **primero** y pasa ese `trail` a los demás módulos.
  Los propios casos de uso de audit también auditan sus consultas por ese mismo puerto.
- **Lo que es de otros módulos llega por puertos:** las sesiones de iam (`SessionDirectory`), las filas de
  dominio que muestra la traza de una sesión (`TracedEntityRegistry`: consentimientos de legal, preferencias de
  notification, dispositivos de iam) y la política de retención de settings (`RetentionSettingsReader`, con el
  caso de uso `GetAuditRetention`). Los implementa `src/main/adapters/audit-sources.adapter.ts` y el container.
- **Reglas en el dominio:** clasificación y alertas (`audit-log.ts`), la bitácora de cambios con su
  enmascarado (`account-change.ts`), el catálogo de acciones (`action-catalog.ts`), la lista client-safe y la
  mezcla del feed (`activity-feed.ts`), los cortes de retención y la key del archivo diario (`retention.ts`).
- **Lo que no era de audit salió a `shared/`:** el enmascarado de PII es dominio puro
  (`shared/domain/pii/masking.util.ts`), `loadUserRefs` es infraestructura de base de datos
  (`shared/infrastructure/database/user-ref.ts`), `buildAuditDiff` es kernel y `adminAuditContext` es
  presentación HTTP.
- **Transitorio:** iam, notification y approvals todavía escriben con `audit.record` del `index.ts`
  (el mismo caso de uso, armado en `infrastructure/legacy/audit-recorder.ts`), iam lee intentos de
  autenticación e historial de cambios por el index, y los intentos de login (que son de iam) viven en audit
  hasta migrar iam.

## Un módulo que trabaja sobre los datos de otro (person)

`person` es la persona detrás de cada cuenta (nombres, documento, contacto, ubicación, referencias), el perfil
propio del titular y el panel de clientes del admin. Casi todo lo que hace toca también el **usuario**, que es de
iam (username, contraseña, estado, rol, MFA, baja).

- **Las cuentas son un puerto:** `ClientAccounts` (leer el perfil completo o la cuenta sobre la que actúa el
  panel, confirmar una contraseña; cambiar username, avatar, contraseña, estado, rol, MFA, baja) y `RoleDirectory`.
  Las formas en que person las lee (`ClientAccount`, `AccountTarget`) y las reglas del panel ("una cuenta eliminada
  es intocable", "el rol solo cambia entre roles de cliente", "qué factores apaga desactivar el MFA") están en
  `domain/client-account.ts`. Los implementa `src/main/adapters/person-sources.adapter.ts` con iam.
- **Lo demás de otros módulos, también por puertos** (en el mismo adaptador): los valores de catálogo que elige la
  persona (`ProfileCatalogs`), los códigos OTP confirmados de notification (`ContactVerifications`), los
  consentimientos de legal que muestra el perfil y que se revocan en la baja (`ProfileConsents`), la doble
  aprobación (`DualApprovalGate`) y la bitácora de cambios (`AccountChangeLog`, el `recordAccountChange` de audit).
  Los avisos a una dirección de email (la vieja tras un cambio, la de una cuenta eliminada) suman el puerto
  `EmailNotifier` a `shared/application`.
- **Reglas en el dominio:** los nombres (`namesChanges`, `fullNameOf`), el formato del documento según el rol, la
  baja (`account-deletion.ts`: qué se ofusca y cómo), qué cambios del perfil van a la bitácora
  (`profile-changes.ts`), la ciudad del departamento y el tope de referencias.
- **Casos de uso compartidos:** `ChangeContactEmail` (el titular con OTP, el admin sin él), `AnonymizeAccount` (la
  baja del titular, la del panel y, por el index, la de los usuarios internos de iam) e `IdentityChecks`
  (unicidad de documento, email y teléfono).
- **La doble aprobación reanuda un caso de uso:** `person.module.ts` devuelve `ExecuteClientAccountDeletion` y
  `src/main/container.ts` lo registra como handler de `CLIENT_ACCOUNT_DELETE` (antes lo registraba el bootstrap de
  approvals importando person).
- **Un esquema que es de otro módulo:** el perfil documenta sus consentimientos con el esquema de legal, así que
  `profile.response.ts` exporta `profileSchema(item)` y `src/main/swagger` le pasa el de legal.
- **Transitorio:** iam usa por el `index.ts` los repositorios con los que crea personas y contactos, la unicidad de
  documento y email, la baja de usuarios internos, la bitácora y las piezas de salida y de entrada de person. Lo
  que necesita adaptadores de otros módulos (la baja, la bitácora) lo deja armado `person.module.ts` en
  `infrastructure/legacy/legacy-bindings.ts`.

## Errores

El dominio lanza errores que dicen **qué regla se rompió**, sin status HTTP:

```ts
// shared/domain/errors/domain-error.ts
NotFoundError · ConflictError · RuleViolationError · ForbiddenError · UnauthorizedError

// modules/settings/domain/errors.ts
export class ActiveConfigNotFoundError extends NotFoundError { … }
```

`shared/presentation/http/domain-error.mapper.ts` los traduce (not_found → 404, conflict → 409,
rule_violation → 422, forbidden → 403, unauthorized → 401) y el manejador de errores responde con el mismo
contrato de siempre (docs/errors-and-retries.md). El mismo caso de uso sirve igual desde un worker o un CLI.

## Tests

Cada capa se prueba con lo mínimo:

| Qué | Cómo | Ejemplo |
|---|---|---|
| Dominio | TypeScript puro, sin mocks | `domain/system-global-config.test.ts` |
| Casos de uso | Dobles en memoria de los puertos (`tests/doubles/`), sin `jest.mock` | `application/use-cases/system-global-config.use-cases.test.ts` |
| Mapper | Fila de ejemplo ↔ entidad | `infrastructure/persistence/system-global-config.mapper.test.ts` |
| Repositorio Prisma | Contra Postgres real | `tests/integration/integrations-config.test.ts` |
| Respuesta HTTP | La salida del caso de uso cumple el esquema Zod (el de Swagger) | `presentation/http/responses/*.response.test.ts` |
| Arquitectura | Imports por capa | `tests/unit/guards/clean-architecture.test.ts` |

## Cómo migrar un módulo (receta)

Usar `settings` como molde. Por cada módulo:

1. **Dominio.** Identificar las entidades y sus reglas (lo que hoy está en `services/` y no es orquestación:
   validaciones, cálculos, transiciones de estado). Crear `domain/` con clases que NO conozcan Prisma.
   Los errores de negocio pasan de `AppError.xxx()` a subclases de `DomainError`.
2. **Puertos.** Por cada repositorio que usa un servicio, una interfaz en `application/ports/*.port.ts` con
   lo que el caso de uso necesita, en términos de entidades. Lo que viene de otros módulos (auditar,
   notificar, buscar un usuario…) también es un puerto.
3. **Casos de uso.** Cada método público de un service pasa a ser una clase en `application/use-cases/` que
   recibe sus puertos por constructor y devuelve un DTO de `application/dto/`.
4. **Infraestructura.** El repositorio actual pasa a `infrastructure/persistence/`, implementa el puerto y usa
   un mapper fila ↔ entidad. Providers y workers van a `infrastructure/`.
5. **Presentación.** Rutas (como factory que recibe controller y guardas), controller (recibe casos de uso),
   requests/responses Zod y docs a `presentation/http/`.
6. **Composición.** `<dominio>.module.ts` con `create<Dominio>Module(deps)` y registrarlo en
   `src/main/container.ts`. Los routers se montan desde el container en `src/main/app.ts`.
7. **Lo que otros módulos usaban.** Si un módulo sin migrar usaba algo de este, se deja en `index.ts` como
   transitorio (marcado `@deprecated`) o se le pasa un caso de uso desde el container.
8. **Tests.** Dobles en memoria en `tests/doubles/`, tests de dominio y de casos de uso sin `jest.mock`.
   El guard de arquitectura empieza a aplicar las reglas apenas existe la carpeta `domain/`.

## Estado y siguientes pasos

| Parte | Estado |
|---|---|
| `shared/` en capas + puertos comunes + errores de dominio | ✅ |
| Composition root (`src/main/`) | ✅ |
| `settings` | ✅ migrado (molde de escritura) |
| `catalogs` | ✅ migrado (molde de solo lectura; respuestas verificadas idénticas a plantilla-base) |
| `banners` | ✅ migrado (agregado BannerCatalog, imágenes por el puerto BannerImageStorage) |
| `legal` | ✅ migrado (consentimientos y políticas; casos de uso que usa iam; caché de catalogs por un puerto; respuestas verificadas idénticas a plantilla-base) |
| `integration` | ✅ migrado (ventanas de fallback del circuit breaker por un listener; procesos afectados por el puerto FailedProcessCounter; respuestas verificadas idénticas a plantilla-base) |
| `audit` | ✅ migrado (RecordAuditEvent detrás del AuditTrail de todos; sesiones, traza y retención por puertos; respuestas y Swagger verificados idénticos a plantilla-base, salvo el arreglo de la exportación CSV/XLSX) |
| `person` | ✅ migrado (las cuentas de iam por el puerto ClientAccounts; la baja que reanuda la doble aprobación; respuestas, estado final de la base y Swagger verificados idénticos a plantilla-base) |
| `notification`, `approvals`, `iam` | ⏳ estructura en capas (orden sugerido) |
| `index.ts` transitorios de `settings`, `catalogs`, `legal`, `audit` y `person` (lo que usan iam, notification, approvals y los adaptadores de `src/main/`) | ⏳ se borran al migrar esos módulos |
| Utilidades de `shared/infrastructure` que lanzan `AppError` (HTTP) | ⏳ deuda conocida, listada en el guard: pasan a errores de `shared/application` al migrar sus usuarios |

Mientras dure la migración conviven las dos formas: los módulos con `domain/` siguen estas reglas y los
demás siguen docs/ARCHITECTURE.md (capas). Cuando el último módulo se migre, se borran los `index.ts`
transitorios, los singletons y las reglas de capas del guard `solid-architecture.test.ts`.

## Clean vs. la plantilla en capas

| | Plantilla en capas (plantilla-base) | Clean (este repo) |
|---|---|---|
| Interfaces | Solo con más de una implementación (YAGNI) | Un puerto por dependencia del caso de uso |
| Entidades | La fila de Prisma | Clases del dominio + mapper |
| Errores del negocio | `AppError` con status HTTP | `DomainError`, la presentación decide el status |
| Dependencias | `constructor(deps = {})` con singletons por defecto | Constructor obligatorio, cableado en la composición |
| Otros módulos | Se importa su `index.ts` | Llegan como puertos desde `src/main/` |
| Tests de servicios | `jest.mock` de módulos | Dobles en memoria de los puertos |
| Archivos por funcionalidad | ~5 | ~10 |

Ninguna es "la correcta": Clean paga más archivos y más cableado a cambio de un negocio que no depende de
la base ni del framework y que se prueba sin mocks.
