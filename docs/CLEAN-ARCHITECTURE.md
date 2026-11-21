# Clean Architecture

Este repositorio es la versión **Clean Architecture** de [plantilla-base](https://github.com/spudy101/base-project)
(misma API, mismas funcionalidades). Este documento explica cómo está organizado y dónde va cada cosa.
Si el código lo contradice, falla un test: `tests/unit/guards/clean-architecture.test.ts`.

> **Estado de la migración:** `shared/` ya está repartido en capas; `settings` y `catalogs` están migrados
> completos (son los **moldes** a copiar: uno de escritura, uno de solo lectura). Los demás módulos siguen con
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
const settings = createSettingsModule({ audit: auditTrailAdapter, notifier: notifierAdapter, logger, guards: routeGuardsAdapter });
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
| `banners`, `legal`, `integration`, `audit`, `person`, `notification`, `approvals`, `iam` | ⏳ estructura en capas (orden sugerido) |
| `index.ts` transitorios de `settings` y `catalogs` (búsquedas que usan iam, person, notification, banners, approvals, audit) | ⏳ se borran al migrar esos módulos |
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
