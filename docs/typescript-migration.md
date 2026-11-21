# Migración a TypeScript

> **Histórico.** Esta migración ya terminó y el documento queda como registro de decisiones. Las rutas y
> la estructura que menciona pueden no existir más: la estructura actual está en [`ARCHITECTURE.md`](ARCHITECTURE.md).

> La plantilla pasó de JavaScript a TypeScript **por fases, en la rama `feat/typescript`** (ver
> [Fases](#fases)): **la migración está completa** — no queda código `.js` en la app, los tests, las
> migraciones ni los scripts (`allowJs: false`). Decisiones tomadas: base en la rama SOLID, Sequelize se
> mantiene (los repositorios aíslan el ORM, ver [`solid.md`](solid.md)), Node 24 LTS.

## Cómo funciona hoy

| Necesidad | Herramienta | Comando |
|---|---|---|
| Desarrollo con hot-reload | `nodemon` + `tsx` (ejecuta los `.ts` sin compilar) | `npm run dev` |
| Revisar tipos | `tsc --noEmit` sobre app + tests + migraciones/seeders + scripts (`tsconfig.test.json`) | `npm run typecheck` |
| Build de producción | `tsc` → `dist/` (CommonJS) | `npm run build` |
| Producción | `node` sobre el build | `npm start` (después de `npm run build`) |
| Tests | Jest + `ts-jest` (solo transpila; `jose`, ESM puro, también pasa por ts-jest) | `npm test` |
| Migraciones / seeders | `sequelize-cli` a través de `tsx` (antes, `db:tracking`: ver abajo) | `npm run db:migrate`, `npm run db:seed` |
| Claves locales | `scripts/generate-keys.util.ts` vía `tsx` | `npm run keys:generate` |
| Lint | ESLint + `typescript-eslint` | `npm run lint` |
| Docker | `node:24-alpine`, `npm run build` en la etapa builder, arranque desde `dist/` | — |

`tsconfig.json` (build): modo **estricto completo** (`strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`…), `allowJs: false`, imports/exports nativos de ES compilados a CommonJS con
`esModuleInterop`. `tsconfig.test.json` extiende el anterior y agrega lo que no entra al build (tests,
`migrations/`, `seeders/`, `scripts/*.ts`), que corre con Jest o `tsx` desde las fuentes.

> ⚠️ `node src/server.ts` no funciona (Node no ejecuta TypeScript del proyecto así). Usa
> `npm run dev` (tsx) o `npm run build && npm start`.

## Reglas del código

1. **Imports/exports nativos.** Cada módulo del proyecto exporta por defecto y se importa con
   `import X from './x'`; los paquetes, con `import { a } from 'pkg'` o `import pkg from 'pkg'`
   (`esModuleInterop`); los tipos, con `import type`. ESLint rechaza `export =` e `import x = require()`
   (puente CommonJS de las fases 1–5). Única excepción: `config/database.ts`, que sequelize-cli carga
   con `import()` y necesita `module.exports`.

   ```ts
   class MiService {
     miRepository: typeof miRepository;
     constructor(deps: MiService.Deps = {}) {
       this.miRepository = deps.miRepository ?? miRepository;
     }
   }

   // Tipos asociados: fusión de declaraciones (namespace con el mismo nombre que la clase)
   // eslint-disable-next-line @typescript-eslint/no-namespace
   namespace MiService {
     export interface Deps { miRepository?: MiRepositoryPort }
   }

   // Instancia por defecto + la clase para tests/composición
   export default Object.assign(new MiService(), { MiService });
   ```

2. **Cargas diferidas** (para cortar un ciclo de imports o no cargar `shared/models` al importar un
   puerto): `interopDefault(require('./x') as typeof import('./x'))` (`src/shared/utils/interop.util`).
   Un `require('./x').default` a secas se rompe cuando `./x` está reemplazado por un `jest.mock` con
   factory (el objeto del mock no tiene `.default`); `interopDefault` hace lo mismo que `import x from`.
3. Sin `any` salvo que esté justificado en un comentario. En tests, la laxitud vive en
   `tests/helpers/mock.ts`: `mocked(mod)` (módulo pasado a `jest.mock`), `fixture(x)` (entrada parcial
   donde el código bajo prueba espera el tipo completo) y `Loose` (parámetros de implementaciones de
   mocks, resultados con la forma de un DTO mockeado). El módulo bajo prueba se importa sin envolver.
4. **Migraciones y seeders**: `export default { up, down } satisfies Migration`
   (`shared/types/migration.ts`), que tipa `queryInterface` y `Sequelize` por contexto.
5. `npm run typecheck && npm run lint && npm test` en verde antes de commitear. La guarda
   `tests/unit/guards/solid-architecture.test.ts` revisa imports, `export default Object.assign(new X(), { X })`
   y `constructor(deps: T = {})`.

> **`db:tracking`** (`scripts/db-tracking-ts.ts`, corre antes de cada `db:*`): sequelize-cli registra lo
> ejecutado por nombre de archivo exacto en `SequelizeMeta`/`SequelizeData`. Al pasar las migraciones de
> `.js` a `.ts`, una BD existente las vería como nuevas y `db:migrate` intentaría correrlas todas otra
> vez; el script renombra los registros `*.js` → `*.ts` (idempotente). Se puede quitar cuando todos los
> entornos hayan corrido una vez una versión con migraciones `.ts`.

## Fases

| Fase | Alcance | Estado |
|---|---|---|
| **1. Infraestructura + núcleo** | tsconfig, build, dev, Jest, ESLint, Docker, CLI de BD vía tsx; `AppError`, `ReadRepository` / `BaseRepository` / `AppendOnlyRepository` (genéricos `<M extends Model>`), `UnitOfWork` (con su puerto `Port`), `domain-enums` (uniones literales), `es256-signature.util` | ✅ |
| **2. Resto de `shared/`** | `constants/`, `utils/`, `dtos/`, `middlewares/`, `services/`, `validators/`, `base/`, `models/index` + mixin: **`shared/` ya no tiene `.js`** | ✅ |
| **3. Modelos + repositorios** | Los 41 modelos tipados **desde su definición real** (`gen-model-types.js`: `Attributes`, `CreationAttributes`, `Instance` con asociaciones, `Static`) y registro tipado `shared/models/registry.ts`; los 41 repositorios en TS con `extends BaseRepository<defineX.Instance>`; contratos `XRepositoryPort` en `src/modules/repository-ports.ts` de los que cada service deriva su puerto con `Pick<…>` | ✅ |
| **4. Dominios** (uno por commit) | `modules/schemas`, `modules/shared-endpoints`, `modules/client`, `modules/admin` (services, controllers, routes, dtos, validators): **`modules/` ya no tiene `.js`** | ✅ |
| **5. Arranque y config** | `servers/` (monolith/client/admin), `config/` (Sequelize, perfiles de BD, Swagger). `npm run dev*` arranca los `.ts`; `.sequelizerc` apunta a `config/database.ts` (sequelize-cli corre vía `tsx`). **Toda la app es TypeScript** | ✅ |
| **6. Cierre** | Tests a `.ts` (`tests/helpers/mock.ts`), migraciones/seeders/scripts a `.ts` (+ `db:tracking` para SequelizeMeta/SequelizeData), `export default` / `import` nativos (`interopDefault` para los require diferidos; excepción: `config/database.ts`), `allowJs: false`, sin Babel | ✅ |

Orden pensado de abajo hacia arriba: cada fase solo depende de capas ya tipadas, así los tipos
"suben" sin `any` intermedios.

## Utilidades para migrar

Scripts en [`scripts/ts-migration/`](../scripts/ts-migration/README.md): codemod `.js` → `.ts` y fixers de
parámetros y `catch` (ver su README para el flujo y las trampas conocidas).

Tipos y helpers compartidos:

- `src/shared/utils/error-message.util.ts`: `errorMessage(e)`, `errorName(e)`, `isOperationalError(e)` para los
  `catch` (con `strict` el error es `unknown`). Si una función recibe un parámetro llamado
  `errorMessage`, usar `errorMessageModule.errorMessage(…)` para no taparlo.
- `src/shared/types/express.d.ts`: propiedades que los middlewares agregan a `req` (`user`, `correlationId`,
  `serverContext`, `externalService`, `lockKey`).
- `src/shared/types/db-rows.ts`: formas mínimas de filas (`UserRefRow`, `DbDate`, `Maybe<T>`) para tipar lo
  que leen los DTOs sin depender de los modelos (estructurales: los modelos tipados de la fase 3 encajan).
- `src/modules/iam/utils/auth-user.util.ts`: `requireAuthUser(req)` — el usuario autenticado tipado, o 401 si la
  ruta quedó sin AuthMiddleware (antes era un `TypeError` → 500).
- **Modelos** (`modules/schemas/**/models/*.model.ts`): la factory `defineX(sequelize)` y sus tipos en un
  namespace fusionado (`defineX.Attributes`, `defineX.CreationAttributes`, `defineX.Instance`,
  `defineX.Static`). Esos tipos los **genera** `gen-model-types.js` desde `rawAttributes`/`associations`:
  al cambiar una columna o asociación se vuelve a correr y no hay desincronización posible. Lo que no se
  genera (métodos de instancia, estáticos como `STATUS`) va en un namespace manual antes del bloque
  generado, que el script conserva. Los timestamps están en `Attributes` como opcionales (`createdAt?`) y
  en `Instance` como `readonly`: en un `where` literal se usa el atributo (`createdAt`), que en los modelos
  `underscored` es la misma columna `created_at`.
- `shared/repositories/query.ts`: `WhereClause` + `toWhere()` para los `where` que se arman por partes
  según filtros opcionales, y `range()` / `dateRange()` para rangos `[Op.gte, Op.lte]`.
- `ReadRepository#aggregate<R>(options)`: `findAll` con `raw: true` para COUNT/AVG/GROUP BY; `R` describe
  las columnas que devuelve (no son instancias del modelo). `ReadRepository#sequelize` para `query()` crudas.
- **Puertos de repositorio** (`src/modules/repository-ports.ts`, generado con
  `gen-repository-ports.js`): `UserRepositoryPort = typeof userRepository`, etc. Un service no depende
  del contrato entero sino de lo que usa: `type UserReader = Pick<UserRepositoryPort, 'findByUserId'>`
  (ejemplo en `src/modules/iam/services/rbac.service.ts`).
- **Services con dependencias** (`constructor(deps = {})`): `class-deps.js` declara cada campo con el
  tipo de su default (`userRepository: typeof userRepository`) y genera `XService.Deps`. Composiciones
  (`deps.x ?? new X(...)`) quedan como `InstanceType<typeof X>`.
- **Controllers**: `requireAuthUser(req)` / `requireAuthPerson(req)` (un `const user` por handler) y
  `routeParam(req, 'id')` (`src/shared/http/route-param.util`): string garantizado o 400. Lo aplica
  `req-user.js`. Cookies de sesión web: `src/modules/iam/utils/auth-cookies.util` (una sola definición).
- **Contextos**: `src/shared/types/audit-context.ts` — `RequestAuditContext` (HTTP: ip, userAgent,
  fingerprint…) y `AdminAuditContext` (quién hace la acción admin). `KeyValueCache`
  (`src/shared/types/cache.ts`) para código que recibe Redis o la caché local indistintamente.
- **Query string**: `PaginationHelper.stringParam(query, 'x')` (string no vacío o null) y
  `PaginationHelper.booleanParam(query, 'x')` (acepta el boolean que dejan los validators con
  `.toBoolean()` — Express 4 reescribe `req.query` — o `'true'`/`'false'`).
- **Contexto admin**: `src/modules/audit/utils/admin-audit-context.util` → `adminAuditContext(req, res)` (antes 6 copias
  locales con variaciones).
- **Tipos que cruzan archivos** van en un `*.types.ts` del dominio (`notification.types`,
  `notification-feed.types`, `profile.types`): un módulo que exporta una instancia (`export default
  new X()`) no deja alcanzar los tipos de su namespace desde otro archivo.
- **Tests**: `tests/helpers/mock.ts` (`mocked`, `fixture`, `Loose`; ver [Reglas](#reglas-del-código)).
- **Migraciones**: `shared/types/migration.ts` (`Migration`, `SequelizeStatic`).
- Campos de clase opcionales que no siempre se asignan: `declare campo?: T`. Con target ES2023
  (`useDefineForClassFields`) un campo sin `declare` se crea como `undefined` en cada instancia.

## Hallazgos de la migración

### Bugs corregidos

- **Ventana de gracia de rotación de refresh token** (`refresh-token-store.util`): se guardaba con
  `JSON.stringify` y se leía con `JSON.parse` sobre lo que `redisClient.get` ya devuelve parseado →
  `getRotation` siempre devolvía `null` y dos `/auth/refresh` concurrentes podían detectarse como
  reuse attack. Corregido (acepta también el formato viejo) y cubierto con test.
- **Webhook con `apiKey` repetida en la query** (`?apiKey=a&apiKey=b`): llegaba un array a la verificación de
  la API key, `crypto` lanzaba y respondía 500. Ahora solo se acepta un string → 401.
- **Push token nunca se guardaba al iniciar sesión** (`user-push-token.repository#upsertToken`): faltaban los
  `await` de `findByDeviceId`/`findByToken`, así que `existing` era siempre una Promise y
  `existing.update()` lanzaba `TypeError`; `auth-login` lo tragaba en su `catch`. Corregido y con test.
- **`AuditLogRepository#register` sí podía lanzar** pese a su contrato ("nunca lanza"): el `try/catch`
  envolvía una Promise sin `await`, así que el rechazo de BD escapaba al llamador. Corregido y con test.
- **Filtros perdidos en `UserChangeLogRepository`**: `findByChangeType` y `findByAdminUser` pasaban claves
  snake_case que `findAllPaginated` no lee, y devolvían los logs de todos (sin llamadores hoy). Corregido
  (se agregó el filtro `changedByUserId`) y con test.

#### Fase 6 (cierre)

Al tipar los `require()` diferidos (antes `any`) aparecieron:

- **Push token con endpoint indefinido**: si SNS no devolvía `EndpointArn`, `_registrarPushToken` hacía el
  upsert con `undefined`. Ahora corta antes (cae en su `catch` de best-effort).
- **Conteo de SMS fallidos en el fallback** (`circuit-breaker.bootstrap`): el `where` usaba `created_at`;
  en modelos `underscored` el atributo es `createdAt`.
- **`logAudit` a BD**: los campos del contexto de la petición (ip, userAgent, correlationId…) llegan como
  `unknown` y se escribían sin verificar; ahora solo van si son string.

Además:

- **Constraint de `system_global_config`**: la migración pedía "una sola config activa" con
  `addConstraint({ type: 'unique', where: { is_active: true } })`, pero Sequelize ignora `where` en las
  UNIQUE: la constraint real es `UNIQUE(is_active)` simple. Se dejó igual (la migración ya corrió en las
  BD existentes y la config global es una sola fila que se actualiza en el lugar) y se documentó en la
  migración. Si algún día hay versiones históricas, hará falta un índice parcial (`addIndex` con
  `unique: true, where`) en una migración nueva.
- **Loadability**: las exclusiones de arranque (`app`, `.server`, `.app`) seguían escritas para `.js` y
  desde la fase 4 no excluían nada; vuelven a excluir.
- **`gen-model-types.js` no era idempotente**: cada corrida sumaba una línea en blanco a cada modelo.

#### Fase 5 (arranque y config)

- **`DB_LOGGING=true` no activaba el log de SQL**: `config/database` comparaba `database.logging === 'true'`,
  pero `logging` ya es boolean (`parseBoolEnv`).
- **Swagger**: el 429 de `send-verification` no se documentaba (`commonResponses.TooManyRequests` no
  existe; es `RateLimitExceeded`) y el 201 de referencias personales usaba `ok()` (documentaba
  `statusCode: 200`) en vez de `created()`.
- `config/config` crea Sequelize con el perfil completo (`new Sequelize(options)`): el perfil de test
  (SQLite) no tiene usuario/clave.

#### Fase 4 (dominios)

- **Push en frío**: `registrarDispositivo` usaba el campo `_snsClient` (null hasta el primer uso del
  getter) → registrar un dispositivo fallaba siempre en un proceso recién levantado. Junto con el bug de
  `upsertToken` (fase 3), el push nunca funcionó. Test.
- **Caída del servidor sin Redis**: tras una notificación global, `cache.del(...).catch` sobre la caché
  local (síncrona) lanzaba `TypeError` en un timer → `uncaughtException` → `process.exit(1)` en
  producción. Test.
- **Entidad relacionada de notificaciones**: se escribía `relatedEntity_type`/`relatedEntity_id`
  (columnas inexistentes, Sequelize las descartaba) y el biométrico pasaba el id suelto en vez de
  `{ type, id }`. Nunca se guardó. Tests.
- **Clientes SES/SNS sin timeout**: `requestTimeout` no es opción del cliente en el SDK v3 y se ignoraba;
  ahora va en `requestHandler`.
- **`blocked_by_device_id`** nunca se guardaba al bloquear un dispositivo. Test.
- **Transacciones ignoradas**: `incrementAttempts` y `roleRepository.findByName` no aceptaban
  `{ transaction }` y corrían fuera de la del llamador. Test.
- **`user_login_attempts.username_attempt`** es NOT NULL y se llenaba con `auth_username` (nullable):
  fallback a `username`.
- **TOTP**: sin `username` en el token, la etiqueta de la app autenticadora quedaba en `'null'`.
- **Seguridad — cambio de rol de clientes** (`PATCH /person/:id/role`): cargaba cualquier usuario por id y
  el guard comparaba `role.name === 'admin'` en minúsculas (los roles son MAYÚSCULAS: nunca coincidía),
  sin límite sobre el rol nuevo. Permitía cambiar el rol de un ADMIN/SUPERADMIN o promover un cliente a
  interno, salteando la doble aprobación de admin-user. Ahora solo opera entre roles de cliente. Tests.
- **Notificaciones del admin sin entidad relacionada**: 12 llamadas pasaban el id suelto como
  `relatedEntity` (sesión, override RBAC, usuario, notificación). Ahora `{ type, id }`; el tipo lo exige.
- **Fechas en null**: `ApprovalRequestComponent` y el drill-down de integraciones leían `created_at`, que
  en modelos `underscored` no existe en una consulta normal (el atributo es `createdAt`): las solicitudes
  de aprobación y las llamadas a proveedores salían sin fecha. Tests.

Falsos positivos descartados al revisar: `acknowledged`/`onlyCritical`/`isActive` llegan como boolean
(`.toBoolean()` del validator), así que esos filtros sí funcionaban.

### Cambios de contrato

- **`UserRepository#create` → `createWithPassword`**: recibía `password` en claro en vez de
  `password_hash`, así que no era sustituible por el `create` del `BaseRepository` (Liskov). Ahora es un
  método propio y `create` vuelve a ser el genérico. Se actualizaron los 3 llamadores y sus tests.
- Overrides que solo llamaban a `super` (`findById`/`delete` en `privacy-policy-admin` y
  `auth-trusted-device`) se eliminaron.
- `JwtUtil.verifyRefreshToken` valida y devuelve claims tipados (`userId`/`jti` obligatorios → 401).
- Recursos inexistentes que antes terminaban en `TypeError` → 500 (contacto/persona del perfil, usuario
  recién creado, fingerprint ausente) ahora responden 404/400 explícitos.

### Código residual eliminado

- **Bypass de autenticación de desarrollo** (residuo de la integración con Cognito: sus tokens falsos
  incluían un `idToken`). Estaba apagado de hecho — la config nunca expuso `server.bypass` — y se
  eliminó de `auth.middleware`, `auth-login`, `token-refresh` y `auth-register`. Si en algún momento se
  necesita un modo de pruebas sin login, debe diseñarse aparte (variable explícita, solo en desarrollo).
- **`InvalidPasswordException`** en `updatePassword` (error de Cognito) y la limpieza de la cookie
  `id_token` (token de Cognito) en logout.

## Qué queda fuera a propósito (por ahora)

- **ORM**: Sequelize se mantiene. Cambiar a Prisma/Drizzle es una decisión aparte; gracias a los
  repositorios afectaría solo a `repositories/` y `models/`.
- **Exports con nombre**: la fase 6 hizo la conversión mecánica `export =` → `export default` (mismo
  valor, cero cambio de comportamiento). Pasar los módulos-objeto (`export default { a, b }`) a
  `export { a, b }` con nombre es un refactor aparte y opcional.
- **Codemods de `scripts/ts-migration/`**: salvo `gen-model-types.js` y `gen-repository-ports.js`, generan
  la sintaxis puente de las fases 1–5; quedan como referencia histórica.
