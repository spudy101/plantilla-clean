# Migración de Sequelize a Prisma (plan)

> **Histórico.** Esta migración ya terminó y el documento queda como registro de decisiones. Las rutas y
> la estructura que menciona pueden no existir más: la estructura actual está en [`ARCHITECTURE.md`](ARCHITECTURE.md).

> **Objetivo:** que la plantilla salga con el stack que suelen pedir los proyectos TypeScript:
> **TypeScript + Prisma**. Se hace por fases, como la [migración a TypeScript](typescript-migration.md):
> al final de cada fase la app arranca y los tests pasan. Durante la migración **Prisma y Sequelize
> conviven contra la misma base**: cada repositorio cambia de ORM sin que los services se enteren.
>
> Estado: **migración completa** (fases 0 a 7) en la rama `feat/prisma`: Sequelize ya no está en el proyecto.
> Ver [Cómo funciona hoy](#cómo-funciona-hoy). El resto del documento queda como registro de cómo se hizo.

## Punto de partida (medido)

Lo que deja la fase SOLID + TypeScript y hace viable el cambio por partes:

- Ningún service importa `sequelize` (la guarda `solid-architecture.test.ts` lo impide): el ORM vive en
  **44 repositorios** y **41 modelos**.
- Transacciones detrás de un puerto (`src/shared/database/unit-of-work.ts`) y cada service depende de los
  métodos que usa (`XRepositoryPort` + `Pick`, `src/modules/repository-ports.ts`).

Lo que hay que resolver (de mayor a menor riesgo):

| # | Tema | Tamaño | Por qué cuesta |
|---|---|---|---|
| 1 | **Cifrado de PII en hooks** | `person`, `person-contact`, `user-trusted-device` + hook global de `origin-session` | `beforeCreate`/`beforeUpdate` cifran y hashean, `afterFind` descifra (también dentro de un `include`). En Prisma son *client extensions*. Un error guarda PII en claro o rompe las búsquedas por hash. |
| 2 | **Transacciones** | 35 archivos | Hoy se pasa `{ transaction }` en las opciones y `unitOfWork.begin()` da commit/rollback manual. Prisma usa `$transaction(async tx => …)` con un cliente `tx` propio. |
| 3 | **Instancias vivas fuera de repositorios** | 10 llamadas + 4 usos directos de modelos (medido con el type checker; la estimación inicial de ~40 venía de un grep con ruido) | Services/workers hacen `record.update()`, `request.reload()`… Prisma devuelve objetos planos: cada uno pasa a ser un método del repositorio. |
| 4 | **Consultas** | 96 `Op.*`, 107 `include`, `BaseRepository` genérico | Reescritura a `where`/`include`/`select` de Prisma; paginación, `searchFields` y filtros del `BaseRepository`. |
| 5 | **Migraciones y seeders** | 45 migraciones (~4400 líneas) + 19 seeders | Triggers de inmutabilidad (auditoría), enums, índices. Pasan a Prisma Migrate con una migración base. |
| 6 | **Tests de integración** | `app-smoke` + CI | Hoy usan SQLite en memoria; en Prisma el proveedor es fijo en el schema → Postgres real en CI. |
| 7 | **Tipos** | 38 archivos usan `defineX.Instance` | Pasan a los tipos que genera Prisma (y desaparecen `gen-model-types.js`, `registry.ts` y los modelos). |

## Decisiones

| Tema | Propuesta | Estado |
|---|---|---|
| Versión | Prisma **7.10.1** (estable; la 8 está en RC). Generador `prisma-client` con `moduleFormat = "cjs"` y driver adapter `@prisma/adapter-pg` (obligatorio en Prisma 7; el query compiler es WASM, sin binarios nativos). | decidida (fase 0) |
| Rama | `feat/typescript` mergeada a `main` (fast-forward); la migración va en `feat/prisma`. | hecho |
| Nombres en el schema | **camelCase con `@map`/`@@map`** (estilo Prisma): la base sigue en snake_case y el mapeo columna ↔ campo lo hace Prisma. El código (services, DTOs, helpers, workers) pasa a leer y escribir camelCase **junto con el repositorio que migra**, sin capa de traducción intermedia: ~1200 accesos `.snake_case` en 100 archivos + ~370 claves en payloads, y `tsc` marca cada uno porque los tipos salen del cliente de Prisma. **El contrato de la API no cambia**: las claves de las respuestas las definen los DTOs. SQL crudo (`aggregate`, `query`) sigue devolviendo nombres de columna. | decidida |
| camelCase en la API | **Sí**: todo lo que es TypeScript o JSON queda en camelCase. Hoy los DTOs ya responden casi todo en camelCase (694 claves) pero quedan **88 claves snake_case en 8 DTOs** (`admin-person`, `profile`, `admin-notification-type`, `user-activity`, `components-audit`, `components-approval`, `components-system-config`, `components-auth`): se normalizan, junto con su Swagger. Es un cambio de contrato para quien consuma esos endpoints; se anota en el changelog del PR. | decidida |
| Columnas de Postgres | **Siguen en snake_case** (`@map`): es la convención de Postgres (un identificador camelCase hay que escribirlo entre comillas en todo SQL crudo, trigger, `psql` o herramienta de reportes) y lo que recomienda la documentación de Prisma; además evita renombrar las columnas de las bases existentes. Para el código es invisible. | decidida |
| Transacciones | `unitOfWork.run(work)` abre una transacción interactiva de Prisma (`maxWait` 5 s, `timeout` 15 s) y la publica en `AsyncLocalStorage` (`src/shared/database/transaction-context.ts`); los repositorios la toman solos (`await this.db()`). Un `run()` anidado se une a la activa. Sin `begin()` manual. Durante la convivencia (fases 2 a 6) coordinaba además la de Sequelize. | hecho (fases 2 y 7) |
| Base de test | Postgres real en un **esquema aislado** (`TEST_DB_SCHEMA`, por defecto `test`) de la misma base de `.env`: `npm run db:test:prepare` lo recrea con las migraciones. En CI, service container `postgres:16-alpine`. Perfil SQLite y `sqlite3` eliminados. Los unitarios no se conectan (verificado: pasan con la base inalcanzable). | hecho (fase 1) |
| Esquema (`DB_SCHEMA`) | App: opción `schema` de `PrismaPg`. CLI: `?schema=` en la URL que arma `src/shared/database/database-url.ts` desde las variables `DB_*` de siempre (no hace falta `DATABASE_URL`). | decidida (fase 0) |

## Convenciones de nombres

La plantilla sigue esta tabla; la migración a Prisma es el momento de dejarla cumplida en todo el proyecto.

| Elemento | Convención | Ejemplo |
|---|---|---|
| Variables, funciones, métodos | camelCase | `userId`, `getUserById()` |
| Clases, interfaces, types, enums | PascalCase | `UserService`, `CreateUserDto`, `LoanStatus` |
| Propiedades de objetos (incluido el JSON de la API) | camelCase | `firstName` |
| Constantes globales | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Archivos y carpetas | kebab-case | `user-service.ts`, `user-management/` |
| Tablas, columnas, foreign keys | snake_case | `user_accounts`, `created_at`, `user_id` |
| Clave primaria | `<tabla_en_singular>_id` | `audit_alert_id`, `credential_reset_id` |
| Tipos ENUM | `enum_<tabla>_<columna>` (modelo PascalCase) | `enum_notification_deliveries_status` |
| Índices | `idx_<tabla>_<columnas>` | `idx_users_email` |
| Constraints | `pk_` / `uq_` / `fk_` / `ck_` + `<tabla>_<columnas>` | `uq_users_email` |

### Estado actual (medido sobre el código y la base local)

| Elemento | Cumple | Desvíos |
|---|---|---|
| Código TS (variables, clases, constantes) | sí | — |
| Enums | sí | Los de dominio son `enum` de Prisma (tipos ENUM en la base, incluido el estado de `global_notifications`, antes varchar). `src/shared/constants/domain-enums.ts` los reexpone en UPPER_SNAKE_CASE tomando los valores del cliente generado, con chequeo de exhaustividad en el typecheck. |
| Archivos y carpetas | sí | `src/modules/audit/catalog/` → `audit-actions/` (fase 6c). |
| JSON de la API | sí | Las 88 claves de los 8 DTOs pasaron a camelCase con su repositorio (fase 5); la 6b cerró `sortBy` y las propiedades internas. Quedan en snake_case solo datos: valores de enum, JSONB guardado y variables de templates (ver [Fase 6b](#fase-6b-api-en-camelcase)). |
| Tablas y columnas | sí | 43 tablas y 505 columnas en snake_case. Las `deletedAt` residuales de `users`, `persons` y `reset_credentials` se eliminaron (fase 6c); `SequelizeMeta`/`SequelizeData`, con el baseline (fase 6). |
| Índices | sí | 245 de 245 con `idx_`/`uq_`/`pk_` (fase 6c); se eliminaron 16 redundantes. |
| Constraints | sí | 41 `pk_`, 26 `uq_`, 47 `fk_`, 1 `ck_` (fase 6c). |
| Claves primarias y ENUM | sí | Desvíos corregidos en `20261119200000_naming_fixes`: 7 PK que no seguían `<tabla_en_singular>_id` (`alert_id` → `audit_alert_id`, `config_id` → `system_global_config_id`, …), `reset_credentials` → `credential_resets` (modelo `CredentialReset`) y los ENUM de notificaciones (`enum_notification_deliveries_channel` / `_status`, `enum_global_notifications_status` sin el `partial_failure` que ya nadie usaba). Las claves de la API (`alertId`, `configId`, `rolePermissionId`…) no cambiaron: los DTOs mapean campo a campo. |

En el schema de Prisma cada nombre de la base va explícito (`@@map`, `@map`, `@id(map: …)`,
`@unique(map: …)`, `@@index(…, map: …)`, `@relation(…, map: …)`); si no, Prisma usa sus propios
nombres por defecto (`*_pkey`, `*_key`, `*_fkey`, `*_idx`). El renombrado en la base es solo de
metadatos (`ALTER INDEX … RENAME`, `ALTER TABLE … RENAME CONSTRAINT`, `RENAME COLUMN`): no reescribe
datos ni bloquea por mucho tiempo.

## Fases

| Fase | Alcance | Estado |
|---|---|---|
| **0. Spike** | Prisma 7 instalado; `prisma db pull` + `scripts/prisma-migration/prisma-names.ts` → `prisma/schema.prisma` (43 modelos, 14 enums) con las convenciones de nombres; cliente CommonJS; `PrismaRepository` (paginación con el mismo contrato que `ReadRepository`); `gender.repository` sobre Prisma y sus 3 consumidores en camelCase. Verificado contra Postgres real, también desde `dist/`. | ✅ |
| **1. Infraestructura** | Logs de Prisma por el logger de la app (consultas solo con `DB_LOGGING=true`); `src/shared/database/database-health.ts`: `/health`, el arranque y el shutdown verifican/cierran Sequelize **y** Prisma; `tests/test-env.ts` (entorno de test compartido por Jest y `db:test:prepare`); perfil `test` sobre Postgres; CI con Postgres, typecheck y `db:test:prepare`. | ✅ |
| **2. Unit of Work** | `run()` coordina una transacción de cada ORM (la de Prisma, perezosa) con el contexto en `AsyncLocalStorage`; `PrismaRepository#db()` toma la transacción activa; los 35 `begin()` → `run()` (32 con el codemod `scripts/prisma-migration/begin-to-run.js`, 3 a mano); test de integración contra Postgres (commit y rollback juntos, aislamiento). | ✅ |
| **3. Instancias vivas** | 10 llamadas a instancias (`update`/`reload` en 5 services de admin, doble aprobación y su worker) → `repository.update(id, …)` o métodos de negocio (`approvalRequestRepository.resolve` / `markExpired`). 4 archivos que usaban modelos directo → repositorios: `audit-archive.worker` (`countCreatedUpTo`/`countCreatedBefore`/`purgeCreatedBefore`), `circuit-breaker.bootstrap` (`countFailedBetween`), `logger.util` e `integration-api-logger.util` (la allowlist de la guarda queda vacía). Guardas: solo repositorios, modelos y `shared/database` importan `shared/models`; `npm run check:orm` (type checker, en CI) rechaza llamadas a instancias fuera de los repositorios. | ✅ |
| **4. PII** | `src/shared/database/pii-fields.ts` (qué se cifra, una sola declaración, con las mismas `EncryptionUtil`/`HashUtil` de los hooks) y `piiExtension` (`src/src/shared/database/prisma-extensions.ts`) en el cliente único: cifra + hash al escribir (también anidado), descifra al leer (también en `include`), rechaza `where` sobre campos cifrados y estampa `originSessionId`. Metadatos de relaciones generados del schema (`scripts/gen-prisma-metadata.ts`). Compatibilidad verificada contra Postgres en los dos sentidos (Sequelize ↔ Prisma, hashes iguales, también dentro del Unit of Work) y, solo lectura, sobre los datos reales del esquema de desarrollo. | ✅ |
| **5. Repositorios** (por grupo, un commit cada uno; ver [Fase 5](#fase-5-repositorios)) | Los 44 repositorios a `PrismaRepository` con su contrato actual; `Op.*` → filtros de Prisma, `include` por nombre de relación; services y DTOs que los consumen, a camelCase en el mismo commit. | ✅ |
| **6. Migraciones y seed** (ver [Fase 6](#fase-6-migraciones-y-seed)) | `prisma/migrations/0_init`: la base que dejaban las 45 migraciones de Sequelize, idéntica objeto por objeto (con CHECK, triggers y comentarios en SQL crudo). `npm run db:migrate` (`scripts/db-migrate.ts`) hace el baseline de las bases Sequelize (`migrate resolve --applied 0_init`) y después `migrate deploy`. 19 seeders → `prisma db seed` (`prisma/seed.ts` + `prisma/seeds/`), re-ejecutable: crea lo que falta y no pisa lo existente. Se fueron `sequelize-cli`, `.sequelizerc`, `db:tracking`, `migrations/` y `seeders/`. | ✅ |
| **6b. API en camelCase** (ver [Fase 6b](#fase-6b-api-en-camelcase)) | Las 88 claves de los 8 DTOs ya salían en camelCase (fase 5). `sortBy` en camelCase (default `createdAt`, también en `metadata.sort.field`; los nombres de columna se siguen aceptando); propiedades TS internas en snake_case → camelCase. | ✅ |
| **6c. Nombres en la base** (ver [Fase 6c](#fase-6c-nombres-en-la-base)) | Migración `20261118120000_naming_conventions`: 16 índices redundantes y las 3 columnas `deletedAt` residuales fuera, `DEFAULT` en los 36 `created_at`, `ON DELETE RESTRICT` en las FK NOT NULL de `person_locations`, estados de procesamiento como enum, 227 índices y constraints renombrados a `pk_`/`uq_`/`fk_`/`ck_`/`idx_`. Schema con todos los `map:` y `migrate diff` vacío contra la base. `domain-enums.ts` derivado de los enums de Prisma; `auditActions/` → `audit-actions/`. | ✅ |
| **7. Cierre** (ver [Fase 7](#fase-7-cierre)) | Fuera `sequelize`, `pg-hstore`, los 41 modelos, `shared/models/` (registry, mixin), los repositorios base de Sequelize, `config/config.ts`/`database.ts`, `DB_DIALECT`, `gen-model-types.js`, `prisma-names.ts` y `check:orm`. Unit of Work, salud y cierre solo con Prisma. Guardas: nadie importa `sequelize`; el cliente de Prisma (valor) solo en repositorios y `shared/database`; los enums generados solo vía `domain-enums.ts`. Docs al día. | ✅ |

Orden: lo que más riesgo tiene (transacciones, PII) se resuelve antes de tocar los repositorios en masa,
y la fase 3 desacopla los services del ORM **antes** del cambio, así la fase 5 queda acotada a `repositories/`.

## Cómo funciona hoy

| Pieza | Dónde |
|---|---|
| Schema | `prisma/schema.prisma`: modelos PascalCase, campos camelCase, nombres de la base con `@@map` / `@map` / `map:`. Es la fuente de verdad (lo produjo `prisma db pull` en la fase 0): cambio → `npm run db:migrate:dev`. Todo índice y constraint con `map:` explícito según la convención. |
| Migraciones | `prisma/migrations/` (SQL sin calificar con el esquema: corren en `DB_SCHEMA`). `npm run db:migrate` = baseline de bases Sequelize + `prisma migrate deploy`; lo corre el entrypoint. Ver [`database.md`](database.md). |
| Seed | `npm run db:seed` → `prisma/seed.ts` con el cliente de la app (PII cifrada por la extensión). Crea lo que falta por clave natural; solo actualiza los templates de los tipos de notificación. |
| Cliente | `npm run prisma:generate` → `src/shared/database/generated/prisma` (gitignored). Corre solo antes de `dev*`, `build`, `typecheck` y `test`. |
| Conexión | `src/shared/database/prisma.ts`: cliente único con `PrismaPg` (DB_*, DB_SCHEMA, TLS salvo localhost, bundle CA de RDS). |
| Transacciones | `src/shared/database/unit-of-work.ts` (`run(async () => …)`) + `transaction-context.ts`. |
| CLI | `prisma.config.ts`: URL desde `DB_*`; sin `DB_HOST` (CI) no la necesita `generate`. `npm run prisma:pull`, `npm run prisma:studio`. |
| Repositorios | `src/shared/database/prisma.repository.ts` (`db`, `paginationArgs`, `searchWhere`). `sortBy` es el campo en camelCase (`createdAt`, el default); el nombre de columna (`created_at`) se sigue aceptando por compatibilidad. Solo campos del modelo. |
| Guardas | `tests/unit/guards/solid-architecture.test.ts`: nadie importa `sequelize`; el cliente de Prisma (valor) solo en repositorios y `shared/database` (`import type` libre); enums generados solo vía `domain-enums.ts`; todo repositorio extiende `PrismaRepository`. `generated/` queda fuera de ESLint. |
| PII | `piiExtension` sobre el cliente único (`src/shared/database/prisma.ts`): los repositorios Prisma leen y escriben PII en claro; en la base va cifrado. Filtrar por un campo cifrado lanza: se filtra por su hash (`hashValue()` de `src/shared/database/pii-fields`). Campo cifrado nuevo → `ENCRYPTED_FIELDS`. |
| Metadatos | `npm run prisma:generate` también escribe `src/shared/database/generated/prisma-metadata.ts` (escalares y relaciones por modelo) para que la extensión recorra anidados. |
| Salud y cierre | `src/shared/database/database-health.ts`: `checkDatabase()` (arranque y `/health`, también el del monolito) y `closeDatabase()` (graceful shutdown). |
| Tests | `npm run db:test:prepare` (una vez y al cambiar migraciones) + `npm test`. Entorno en `tests/test-env.ts`: Postgres, esquema `TEST_DB_SCHEMA` (por defecto `test`), sin TLS; `db:reset` se niega a tocar `public`. |

### Fase 7: cierre

- **Unit of Work:** `run()` = `prisma.$transaction(tx => runInUnit({ prisma: () => tx }, work))`. Ya no hace
  falta la transacción de Prisma "perezosa" (servía para no ocupar una segunda conexión en flujos solo-Sequelize).
  El trabajo ya no recibe un parámetro `transaction`: los 26 `run(async () => …)` no lo usaban.
- **Bug encontrado:** `dualApproval.annotatePending` deducía el id de la fila con
  `constructor.primaryKeyAttribute` (de Sequelize). Con las filas planas de Prisma devolvía las filas sin
  anotar, en silencio: desde que `users` pasó a Prisma (fase 5, grupo 6) el listado de usuarios internos no
  marcaba las solicitudes de doble aprobación pendientes. `idField` pasa a ser obligatorio (`'userId'`), con test.
- **`/health` del monolito** llamaba a `sequelize.authenticate()` directo (no pasaba por `checkDatabase`): ahora
  usa `checkDatabase()`, como el resto.
- **Tests:** los unitarios mockeaban `shared/models` (`sequelize.transaction`); ahora mockean
  `src/shared/database/prisma` (`$transaction`) con el mismo helper (`tests/helpers/transaction.ts`). Salieron los
  de convivencia (`cross-orm-locks`, la compatibilidad Sequelize ↔ Prisma de PII) y los de la jerarquía de
  repositorios de Sequelize; `pii-encryption.test.ts` y `unit-of-work.test.ts` quedan solo con Prisma.
- **Verificado:** typecheck, lint (0 errores; las advertencias bajaron de 131 a 28 con los modelos), 1490
  tests, `npm run build` y la app compilada arrancando contra Postgres (`/health` sano, un endpoint de
  catálogo respondiendo).

### Fase 6c: nombres en la base

- **Generador:** `scripts/prisma-migration/db-names.ts` lee el catálogo y escribe el bloque de renombres de la
  migración y los `map:` del schema (los mismos nombres en los dos lados). Reglas: `pk_<tabla>`,
  `uq_`/`fk_`/`ck_<tabla>_<columnas>`, `idx_<tabla>_<columnas>`; un nombre que ya empezaba con
  `<prefijo>_<tabla>_` se respetó (`idx_audit_alerts_pending`, `uq_approval_requests_pending_entity_op`); si
  pasa de 63 caracteres se abrevia la tabla (`uq_user_notif_prefs_user_id_notification_category_code`).
- **Índices redundantes:** 4 índices únicos duplicaban un UNIQUE constraint y 12 índices simples repetían
  las columnas de una PK/UNIQUE (`users_username` ≡ `users_username_key`…). Se eliminaron. La FK de
  `user_notification_preferences` a `notification_categories(code)` se había atado al índice duplicado: se
  recrea igual, sobre el UNIQUE.
- **`deletedAt` residuales:** vacías en la base de desarrollo y sin uso en el código; se eliminaron con sus
  índices. El borrado lógico de `users` sigue en `deleted_at`.
- **Enum de procesamiento:** `notifications.processing_status` y `global_notifications.push_/email_processing_status`
  pasan de varchar a `enum_notification_processing_status` (`USING … ::enum`: un valor fuera del enum hace
  fallar la migración entera en vez de perder datos). Los repositorios tipan el estado con el enum; el
  validador de entregas toma la lista de `domain-enums.ts`.
- **Verificación:** `0_init` + esta migración sobre un esquema vacío → `prisma migrate diff` contra el schema
  da migración vacía; 245 índices y 115 constraints con su prefijo, 0 columnas camelCase, 0 `created_at` sin
  DEFAULT. Ningún código dependía de nombres de constraint (el manejo de P2002 usa los campos).

### Fase 6b: API en camelCase

**Cambios de contrato** (para el changelog del PR):

- `sortBy`: el contrato es el **campo en camelCase** (`createdAt`, `updatedAt`, `isActive`…). El default pasó de
  `created_at` a `createdAt`, así que `metadata.sort.field` de los listados ahora responde `createdAt` cuando el
  cliente no manda `sortBy`. Los nombres de columna (`created_at`) **se siguen aceptando**: los repositorios los
  pasan a camelCase. `GET /admin/api/v1/kyc/person` aceptaba solo `username|created_at|updated_at|is_active`; ahora acepta
  también la forma camelCase (Swagger y el mensaje de error muestran esa).
- Ninguna clave de respuesta cambió en esta fase: los DTOs ya respondían en camelCase desde la fase 5.

**Internos** (sin efecto en la API): resultado de `crearNotificacion` (`notificationId`/`globalNotificationId`,
`estadoSolicitud`), matriz RBAC (`basePermissions`/`addedPermissions`), `requestContext.originFromContext()`
(`originSessionId`/`originCorrelationId`), estado del lote de notificaciones globales en la caché, resultados y
logs de las limpiezas, y `UserLoginAttemptComponent` (leía campos snake_case que Prisma ya no devuelve; la columna
`session_cache_key` no existe: la clave queda en `null`).

**Se quedan en snake_case a propósito** (son datos, no claves de TS/JSON de la API): valores de enum
(`mfa_status`, `revoked_by_admin`…), nombres de tabla/columna en SQL crudo y descripciones, el JSONB guardado
(`integrationResilience`, banners promocionales: el DTO lo traduce a camelCase), las variables de los templates
de notificación que viven en la base (`{{nuevo_rol}}`, `{{permisos_descripcion}}`) y el nombre de la cookie
`refresh_token`. Los modelos de Sequelize se van en la fase 7.

### Fase 6: migraciones y seed

- **Cómo se generó `0_init`:** `prisma migrate diff --from-empty --to-config-datasource` sobre un esquema recién
  migrado con Sequelize, sin el calificador de esquema (Prisma 7 escribe `"<esquema>".tabla`) ni las tablas
  `SequelizeMeta`/`SequelizeData`. Prisma no lee del catálogo, y por eso se agregaron a mano: el CHECK de
  `consent_types`, las dos funciones + triggers append-only (`audit_logs`, `user_change_logs`) y los 186
  comentarios de tablas y columnas. Los 26 UNIQUE van como **constraint** (`ADD CONSTRAINT … UNIQUE`), como los
  creaba Sequelize, no como índice único (lo que escribe Prisma): así las bases nuevas y las existentes son
  iguales y la 6c renombra lo mismo en las dos.
- **Verificación:** `scripts/prisma-migration/compare-schemas.ts` compara dos esquemas en el catálogo de
  Postgres (columnas con tipo/NULL/default, constraints, índices, enums, funciones, triggers, comentarios):
  1091 objetos, cero diferencias contra el esquema migrado con Sequelize y contra la base de desarrollo real.
  `migrate diff` de la base contra el schema da solo lo de la 6c (DEFAULT de `created_at` y la columna
  `users."deletedAt"` con su índice). `migrate dev` sobre una base con baseline no reporta drift.
- **Índice con el nombre del esquema:** Sequelize nombró `<esquema>_user_sessions_user_id_status` (el
  `addIndex` con `{ schema }` antepone el esquema): en `0_init` y en el schema es
  `idx_user_sessions_user_id_status`, y el baseline renombra el de las bases existentes.
- **Baseline automático:** `npm run db:migrate` detecta `SequelizeMeta`, exige las 45 migraciones (y ninguna
  desconocida), renombra el índice, marca `0_init` como aplicada y borra el tracking de Sequelize.
  Idempotente; probado sobre un esquema creado con Sequelize (resultado idéntico al de `0_init`).
- **Seed re-ejecutable:** con sequelize-cli cada seeder corría una sola vez por base (`SequelizeData`); los de
  tipos de notificación hacían "borrar por code y reinsertar". `prisma db seed` no lleva registro, así que
  cada seed crea lo que falta por su clave natural y no borra ni modifica (borrar tipos referenciados por
  notificaciones fallaría o se llevaría lo editado en el admin). Los templates de los tipos sí se
  actualizan: la API no los edita. La categoría de cada tipo solo se asigna si no tiene.
- **Contenido verificado:** el seed sobre un esquema vacío deja los mismos datos que los seeders de
  Sequelize en la base de desarrollo (8 países, 8 prefijos, 33 departamentos, 74 ciudades, catálogos,
  configuración, 6 categorías, 49 tipos con sus templates byte a byte, y los 2 usuarios internos con la
  PII cifrada y los mismos hashes). Segunda corrida: no crea ni cambia nada.
- **Prisma 7** ya no corre el seed desde `migrate dev`/`migrate reset`: se llama `npm run db:seed` (o
  `db:reset`).

### Fase 5: repositorios

Orden por grupos. Un grupo se migra junto cuando (a) comparte transacciones que tocan las mismas filas
(regla de la convivencia) o (b) sus filas llegan a los mismos DTOs: un componente de DTO no puede recibir
filas de Prisma (camelCase) y de Sequelize (snake_case) a la vez.

| Grupo | Repositorios | Estado |
|---|---|---|
| 1. Catálogos | gender, country, department, city, phone-prefix, document-type, avatar-theme, avatar | ✅ |
| 2. Legal | consent-type, privacy-policy, privacy-policy-admin, user-consent | ✅ |
| 3. Notificaciones | notification-category, notification-type, notification, global-notification, global-notification-read, user-notification-preference, user-push-token, verification-code, sms-delivery-attempt, email-bounce-suppression | ✅ |
| 4. Integraciones y config | system-global-config, integration-api-log, provider-fallback-event, approval-request | ✅ |
| 5. Auditoría | audit-log, audit-alert, user-login-attempt (user-change-log pasa al grupo 6) | ✅ |
| 6. Núcleo de identidad | user, person, person-contact, person-location, person-reference, role, role-permission-override, user-session, auth-trusted-device, biometric, reset-credentials, user-change-log | ✅ |

Receta por repositorio:

1. `extends PrismaRepository` y los métodos que usan sus consumidores (`grep` del nombre del repositorio;
   lo heredado de BaseRepository que nadie usa no se reescribe). `await this.db()` en cada método.
2. Listados: `this.listQuery(filters, pagination, searchTerm, { sortable, searchFields, filterId })` y
   `findMany` + `count`. Los `include` por defecto se copian con los mismos campos (`select`), así la
   respuesta no cambia.
3. `node scripts/ts-migration/gen-repository-ports.js` y `npx tsc`: cada consumidor que todavía lee
   snake_case es un error de tipos → camelCase (services, helpers, DTOs y sus tipos de fila).
4. Tests: los fixtures de los mocks a camelCase. Un test que pasa igual con el fixture viejo prueba algo
   equivocado: agregar el caso positivo (ver `profile.helper.test.ts`).
5. Verificar contra la base de desarrollo los listados y búsquedas del grupo (totales iguales a Sequelize).

#### Hallazgos del grupo 6

- **Fin de la convivencia en los flujos**: ningún service escribe ya con Sequelize. Los consentimientos y la
  preferencia de notificación del registro vuelven a la transacción del alta, y sin best-effort (dentro de
  una transacción no puede haberlo: un INSERT fallido la aborta, ver grupo 2): la cuenta se crea con su
  constancia de consentimiento o no se crea. `user-change-log` se escribe en la misma unidad que el cambio
  del usuario (`cross-orm-locks.test.ts` ahora prueba que confirma y revierte junto, sin esperar locks).
  `unitOfWork.run()` todavía abre la transacción de Sequelize, que nadie usa: se va en la fase 7.
- **Lecturas silenciosas por tipos laxos**: helpers tipados con objetos de campos opcionales
  (`assertNotDeleted({ deleted_at? })`, `displayName`, `buildAuditDiff` con nombres de columna) compilaban
  con las filas camelCase y leían `undefined` (`assertNotDeleted` dejaba pasar cuentas eliminadas). `tsc`
  no los marca: se buscaron con un barrido de accesos snake_case a las columnas del grupo.
- **`...requestContext.originFromContext()` dentro de un `create` de Prisma**: claves snake_case en un spread
  (tsc no aplica excess property checks) → Prisma lo rechaza en runtime. Se quitaron: la extensión estampa el
  origen.
- **Consumos de un solo uso atómicos**: el token de reset y el challenge biométrico se marcaban con un
  UPDATE sin condición después de leerlos; dos requests simultáneos los usaban los dos. `markAsUsed` solo
  marca si sigue sin usar y devuelve si lo hizo; el reset de credenciales lo consume antes de aplicar el
  cambio y revierte si otro request ganó.
- **Prefijo telefónico del contacto**: `PersonContactComponent` leía alias (`primaryPrefix`) que ninguna
  consulta traía; `phonePrimaryPrefix`/`phonePrimaryFull` salían sin prefijo. Ahora lee la relación.
- `user_sessions` no declara relación con `users`: el usuario de las vistas admin (`sessionUser`) se adjunta
  por lote con `loadUserRefs` (el de auditoría). Un `status` fuera del enum en el listado devuelve vacío.
- `findById(id, { include })` de Sequelize en los services → métodos con nombre (`findAdminTarget`,
  `findWithPrimaryPhone`, `findByIdWithRole`, `findForAccountDeletion`). `UserRepository.INCLUDES` conserva
  los niveles (`full`/`basic`/`auth`/`login`/`minimal`) y `UserWith<'nivel'>` tipa cada uno.
- `user_change_logs` es append-only también para el borrado en cascada: las filas de los tests de
  integración quedan en el esquema `test` (lo reconstruye `db:test:prepare`).
- Caché de overrides RBAC: la entrada pasó a camelCase (`moduleName`); la clave cambió a
  `rbac:overrides:v2:` para no leer entradas viejas durante el TTL.
- `verifyPassword` acepta `passwordHash` nulo (la columna lo es) y devuelve `false`.
- `HmacService` sigue buscando el dispositivo solo por fingerprint, de cualquier usuario
  (`findAnyByFingerprint`), como antes: el request firmado no trae el usuario.
- Verificado contra la base de desarrollo (chica: 3 usuarios, sin change-logs ni overrides): totales y
  búsquedas de usuarios, perfil completo con PII descifrada, login por documento, contacto por email,
  sesiones con usuario, última sesión por dispositivo, `hmac_secret`, roles y change-log iguales a Sequelize.

#### Hallazgos del grupo 5

- **`user-change-log` pasa al grupo 6**: se escribe en la misma unidad en que Sequelize edita al usuario, y
  si esa edición toca una columna UNIQUE (`username` al eliminar la cuenta) el INSERT con FK de Prisma
  queda esperando el lock hasta el timeout. Probado en `cross-orm-locks.test.ts`.
- **La auditoría va fuera de la transacción del flujo**, como con Sequelize: `audit-log` y `audit-alert`
  escriben con `independentDb()` aunque haya una unidad activa, así un flujo revertido conserva su rastro.
- **Unidad de trabajo cerrada al terminar `work`** (ver reglas de la convivencia): sin eso, logAudit (que
  persiste en `setImmediate`) heredaba el contexto y con Prisma escribía en una transacción ya cerrada.
- `audit_logs`/`audit_alerts` no declaran relación con `users` (user_id es trazabilidad): el executor, el
  actor y quien reconoce se adjuntan con una consulta por lote. `countBySessionIds` pasa a `groupBy`.
- La purga de retención usa una transacción propia de Prisma con `SET LOCAL app.allow_audit_purge`, que
  el trigger append-only acepta (probado contra Postgres).
- `acknowledge`/`acknowledgeBulk` devuelven la cantidad de filas (antes `[n]` de Sequelize).
- Verificado contra la base de desarrollo: totales, filtros, intentos de autenticación, primera página con
  executor, alertas e intentos de login iguales a Sequelize.

#### Hallazgos del grupo 4

- **Errores de restricción de Prisma salían como 500**: el middleware de errores solo traducía los de
  Sequelize. Ahora `P2002` (UNIQUE) → 409 con la etiqueta del campo, `P2003` (FK) → 400 y `P2025` → 404,
  igual que antes. Afectaba también a los grupos 1–3 (p. ej. dos altas simultáneas del mismo código).
  `integrations-config.test.ts` lo prueba con la UNIQUE parcial de solicitudes pendientes.
- **Doble aprobación**: `requester` y `secondApprover` se incluyen en la misma consulta (en Sequelize,
  incluir `User` dos veces con su persona daba SQL inválido y se resolvían aparte). Sin transacciones
  compartidas con otros grupos: el flujo no usa unidad de trabajo.
- **Bitácora de integraciones**: el schema no declara relación con `users`/`user_sessions` (columnas de
  trazabilidad sin FK), así que usuario y sesión se adjuntan con una consulta por tabla. Las estadísticas
  pasan a `groupBy`. Un producto o resultado fuera del enum devuelve vacío sin consultar (Postgres
  rechazaría el valor).
- **Configuración global**: `configVersion` se incrementa en la base (antes `actual + 1`: dos ediciones
  simultáneas quedaban con la misma versión). Los JSON (`integration_resilience`,
  `promotional_banners`) siguen en snake_case: son datos guardados, no columnas.
- `thresholdConfigKey` de la doble aprobación acepta el nombre de la columna o del campo.
- Verificado contra la base de desarrollo: configuración activa (incluidos los JSON), totales y
  estadísticas de la bitácora, solicitudes y fallbacks iguales a Sequelize.

#### Hallazgos del grupo 3

- **Misma FK entre ORMs que en el grupo 2**: el registro creaba la preferencia global de notificación
  dentro de la transacción del alta. Pasa a después del commit, best-effort: sin la fila rigen los mismos
  valores (`findByUserAndCategory` → null → todo permitido) y la primera edición desde el perfil la crea.
  Es el único flujo del grupo que escribía junto a `users`/`persons` en una unidad.
- **Columnas `TIME`** (horario de no molestar): Sequelize las devolvía como `'HH:MM:SS'` y así las comparan
  el programador y la API; Prisma las mapea a `Date`. `src/src/shared/database/prisma-time.ts` convierte en el
  borde del repositorio, así que hacia afuera siguen siendo texto.
- **Contadores leer-y-escribir**: `record*Error` (reintentos por canal), `registerHardBounce` (rebotes) y
  `increment*SentCount` se hacían leyendo y escribiendo; dos errores simultáneos perdían uno. Ahora
  incrementan en la base (`{ increment }`); los de varios pasos (`upsertToken`, upserts de preferencia,
  `registerHardBounce`) son atómicos con `PrismaRepository#atomic`.
- **Upsert de la preferencia global**: la UNIQUE `(user_id, notification_category_code)` no sirve con la
  global (en Postgres NULL ≠ NULL), así que no se usa `upsert` de Prisma: buscar + crear/actualizar atómico.
- `global_notifications.starts_at` tenía el DEFAULT now() en el modelo de Sequelize y no en el schema de
  Prisma: el repositorio lo pone al crear (sin eso la global no aparecía como vigente).
- Unidades de trabajo alrededor de una sola escritura (categorías, tipos, preferencias, códigos de
  verificación) se quitaron: una sentencia ya es atómica y la unidad abría una transacción de Prisma
  innecesaria. `crearNotificacion` ya no recibe transacción (nadie se la pasaba): dentro de
  `unitOfWork.run()` la toma del contexto.
- Las respuestas de la API no cambian: las claves `notification_id` / `global_notification_id` /
  `estado_solicitud` de `crearNotificacion` y las filas de `deliveryMetrics` (SQL crudo) siguen en snake_case.
- Verificado contra la base de desarrollo: totales de categorías, tipos (con búsqueda), entregas (con
  filtros por canal y criticidad), métricas por categoría, no leídas, preferencias y tokens iguales a Sequelize.

#### Hallazgos del grupo 2

- **Una FK entre ORMs dentro de la misma unidad falla**: el registro creaba el `user` (Sequelize) y en la
  misma transacción insertaba en `user_consents`. Con `user-consent` en Prisma, ese INSERT va por otra
  conexión y la FK no ve el usuario sin confirmar (`tests/integration/legal-consents.test.ts` lo prueba).
  Los consentimientos del registro se graban **después del commit** del alta (ya eran best-effort, con
  alerta `CONSENT_RECORD_FAILED` y respaldo en `users.privacy_policy_*`); vuelven a la transacción cuando
  migre `user` (grupo 6). Es la regla de la convivencia aplicada a FKs, no solo a la misma fila: mismo
  caso para `user-notification-preference` (grupo 3), que también se crea en el alta.
- Ese `.catch` "best-effort" dentro de la transacción no lo era: un INSERT fallido aborta la transacción
  de Postgres y el resto del alta fallaba igual. Fuera de la transacción sí es best-effort.
- `grant`, `revoke` y `createVersion` (desactivar la versión activa + crear) eran dos escrituras sueltas
  fuera de una unidad de trabajo; ahora son atómicas (`PrismaRepository#atomic`: se une a la unidad si
  hay una, si no abre `$transaction`).
- Alta de tipo de consentimiento: la unicidad se verificaba con el código tal como llegaba y se guardaba
  en mayúsculas (`abc` pasaba el chequeo aunque existiera `ABC` → 500 por la UNIQUE). Se verifica el
  código normalizado.
- El usuario incluido en un consentimiento sale en camelCase (`_buildConsentUserRef`); el de las filas
  de auditoría sigue en snake_case hasta el grupo 5.
- Verificado contra la base de desarrollo: totales de listados y filtros, búsqueda, orden por
  `effectiveDate`, política activa, historial y nombres descifrados en el include iguales a Sequelize.

#### Hallazgos del grupo 1

- Nombres de relación heredados mal pluralizados (`phonePrefixs`): `prisma-names.ts` pluraliza bien
  `x/z/ch/sh` → `phonePrefixes`.
- `profile.helper.test` ("ciudad de otro departamento → 400") seguía pasando con el campo mal leído:
  `city.departmentId` era `undefined` y también daba distinto. Se agregó el caso positivo.

### Reglas de la convivencia (fase 2)

- **Un flujo transaccional no toca la misma fila con los dos ORMs**: son dos conexiones, así que la segunda
  esperaría el lock de la primera hasta el timeout de Prisma (15 s). Falla ruidoso, no corrompe datos.
  Por eso en la fase 5 cada flujo transaccional se migra entero.
- **Tampoco una fila que la otra referencia por FK**, si la primera la acaba de crear (la FK no ve la fila sin
  confirmar: grupo 2) o le cambió una columna UNIQUE (Postgres toma FOR UPDATE y la verificación de la FK
  espera: grupo 5). `cross-orm-locks.test.ts` y `legal-consents.test.ts` lo prueban.
- **Lo que una unidad deja en segundo plano no usa su transacción**: al terminar `work` la unidad se cierra
  (`ActiveUnit.closed`); un `setImmediate` programado adentro (logAudit, notificaciones) corre con el
  cliente normal en vez de una transacción ya cerrada o una nueva que nadie confirmaría.
- **No es atómico si falla el commit de la segunda transacción** (la de Sequelize, después de confirmar la de
  Prisma). Un error de negocio dentro de `work` revierte las dos; solo un fallo del propio COMMIT deja una
  confirmada y la otra no. Desaparece al quitar Sequelize.

### Hallazgos de la fase 4

- **Hash viejo al vaciar un campo**: el hook de Sequelize solo recalculaba el hash si el valor nuevo era
  no vacío, así que borrar un teléfono dejaba su hash y la fila seguía apareciendo al buscar por ese
  número. En Prisma, poner el campo en `null` también pone el hash en `null`.
- **`where` sobre un campo cifrado nunca coincide** (IV aleatorio) y no daba error: ahora la extensión lo
  rechaza con un mensaje que dice qué hash usar.
- **Las consultas de Prisma son perezosas**: corren al hacer `await`, no al llamarlas. Si se devuelve la
  promesa sin esperarla dentro de `requestContext.run()` (o de un `unitOfWork.run()`), se ejecuta afuera y
  pierde el contexto (origen de sesión, transacción). Los repositorios son `async` y esperan adentro.
- **El `schema` de `PrismaPg` no cambia el `search_path`**: las consultas de modelo van calificadas, pero
  un `$queryRaw` sin esquema apunta al `search_path` por defecto. En SQL crudo, calificar con DB_SCHEMA.
- Relaciones con nombres heredados en snake_case de los alias de Sequelize (`document_type`,
  `phone_primary_prefix`, `login_attempts`…) pasan a camelCase en el schema; los repositorios que las
  incluyan las usan con ese nombre al migrar.

### Hallazgos de la fase 3

- **El worker de vencimiento podía pisar una aprobación**: leía las pendientes vencidas y después hacía
  `request.update({ status: EXPIRED })` sobre la instancia, sin volver a mirar el estado. Si un admin la
  aprobaba en el medio, quedaba como vencida. `markExpired` solo marca si sigue `pending` y el worker no
  audita las que no marcó.
- `dual-approval` recargaba con `request.reload()` una instancia a la que `findByIdWithUsers` le había
  adjuntado los usuarios a mano; `resolve()` vuelve a leerla con `findByIdWithUsers` (incluye al aprobador).
- `repository.update()` devuelve `null` si la fila desapareció entre la lectura y la escritura: los
  services que la usan responden 404 en vez de seguir con `null`.

### Hallazgos de la fase 2

- **Rollback sobre una transacción confirmada**: el patrón `begin(); try { …; commit(); <auditoría/DTO> } catch
  { rollback(); throw }` revertía en el catch también los errores ocurridos DESPUÉS del commit; Sequelize
  lanza entonces su propio error y tapa el original. Con `run()` lo posterior al commit queda fuera.
  (`person-creation` ya lo esquivaba con un flag `transactionFinished`, que se eliminó.)
- `update` de tipos y categorías de notificación abría una transacción solo para revertirla en el camino
  "sin cambios": ahora valida antes y la transacción envuelve solo la escritura.

### Hallazgos de la fase 0

- **`users` tiene dos columnas de borrado lógico**: `deleted_at` (la que usa la app) y `deletedAt`, que creó la
  migración y nadie escribe; `persons.deletedAt` y `reset_credentials.deletedAt` tampoco las usa ningún
  modelo. La de `users` queda fuera del schema (Prisma no deja mapear a un nombre que ya usa otro campo).
  Eliminadas en la fase 6c (con su índice `users_deleted_at`).
- **`person_locations.city_id` y `department_id` son NOT NULL con `ON DELETE SET NULL`**: borrar una ciudad
  o un departamento con ubicaciones falla por la NOT NULL. Fase 6c: `ON DELETE RESTRICT` (hecho).
- **`created_at` no tiene DEFAULT en la base** (lo ponía Sequelize): el schema usa `@default(now())` y
  `@updatedAt` (lo hace el cliente); la fase 6c agregó los DEFAULT a la base. Las PK uuid sin default usan
  `@default(uuid())` (igual que el UUIDV4 de Sequelize).
- 31 relaciones inversas no tenían asociación en Sequelize: el script les dio nombre (`User.notifications`,
  `PhonePrefix.personContactsByPhonePrimaryPrefix`…); se revisan al migrar cada dominio.

## Riesgos y cómo se cubren

- **PII ilegible o en claro** → fase 4 aislada, con tests de compatibilidad contra datos escritos por la
  versión Sequelize, y verificación manual sobre la base local antes de seguir.
- **Bases existentes** → la migración base no se ejecuta en ellas: `npm run db:migrate` hace el baseline
  (`migrate resolve --applied 0_init`) y se niega si la base no tiene exactamente las 45 migraciones de
  Sequelize; `compare-schemas.ts` verifica una base contra `0_init` antes de desplegar.
- **Comportamiento de transacciones** (aislamiento, timeouts de `$transaction`) → tests de los flujos de
  doble aprobación, registro y login, que hoy usan transacciones manuales.
