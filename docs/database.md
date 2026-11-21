# Base de datos — migraciones, seed y reset

> PostgreSQL + Prisma Migrate. Cómo se aíslan los esquemas, cómo se cambian las tablas, qué hace el seed
> y cómo se adoptan las bases que creó la versión con Sequelize.

---

## Aislamiento por esquema (`DB_SCHEMA`)

Una misma instancia Postgres puede alojar **varios esquemas** (p. ej. el template en `plantilla` y un
proyecto real en otro). El esquema activo lo fija `DB_SCHEMA` en `.env`: el CLI de Prisma lo recibe como
`?schema=` en la URL que arma `src/shared/database/database-url.ts`, y la app como opción de `PrismaPg`.

Las migraciones (`prisma/migrations/*/migration.sql`) **no nombran el esquema**: corren en el que elige
la URL, y el historial (`_prisma_migrations`) vive dentro de ese esquema. Apuntar `DB_SCHEMA` a otro
esquema migra y siembra desde cero **sin tocar** los demás.

> **Antes de cualquier comando destructivo**, verificá `DB_SCHEMA` en `.env`. `db:reset` tiene además una
> guarda que **aborta si `DB_SCHEMA` está vacío o es `public`** (`scripts/db-reset.ts`).

---

## Comandos

| Comando                     | Qué hace                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run db:migrate`        | Aplica las migraciones pendientes (`prisma migrate deploy`). Es lo que corre el despliegue. |
| `npm run db:migrate:dev`    | Desarrollo: genera una migración nueva a partir de los cambios en `prisma/schema.prisma`.   |
| `npm run db:migrate:status` | Qué migraciones están aplicadas y cuáles faltan.                                            |
| `npm run db:seed`           | Datos base (`prisma db seed` → `prisma/seed.ts`). Se puede correr las veces que haga falta. |
| `npm run db:reset`          | **Dropea y recrea el esquema**, luego migra + siembra desde cero.                           |
| `npm run db:fresh`          | Alias de `db:reset`.                                                                        |
| `npm run db:test:prepare`   | `db:reset` sin seed sobre el esquema de test (`TEST_DB_SCHEMA`, por defecto `test`).        |

---

## Cambiar el esquema

1. Editá `prisma/schema.prisma` (modelos PascalCase, campos camelCase, nombres de la base con
   `@@map`/`@map`: ver [`prisma-migration.md`](prisma-migration.md#convenciones-de-nombres)). **Todo índice y
   constraint lleva su nombre explícito** (`map:`) según la convención: `@id(map: "pk_<tabla>")`,
   `@unique(map: "uq_<tabla>_<columnas>")`, `@relation(…, map: "fk_<tabla>_<columnas>")`,
   `@@index([…], map: "idx_<tabla>_<columnas>")`. Sin `map:` Prisma usa sus nombres por defecto (`*_pkey`,
   `*_key`, `*_fkey`, `*_idx`). Tablas en plural y snake_case; la PK se llama `<tabla_en_singular>_id`
   (`audit_alert_id`) y un tipo ENUM, `enum_<tabla>_<columna>` (`enum_notification_deliveries_status`).
2. `npm run db:migrate:dev -- --name <qué-cambia>` genera `prisma/migrations/<timestamp>_<nombre>/migration.sql`,
   la aplica a tu base y regenera el cliente. Revisá el SQL antes de commitearlo: es lo que corre en
   producción.
3. Lo que Prisma no modela (triggers, funciones, CHECK, comentarios de columnas) se escribe a mano en el
   `migration.sql` (con `--create-only` se genera sin aplicar, para editarlo antes).

Las migraciones se acumulan y no se editan una vez desplegadas: Prisma guarda el checksum de cada una y
`migrate deploy` rechaza una migración aplicada que cambió.

`migrate dev` necesita crear una base sombra temporal (permiso `CREATEDB` del usuario de Postgres): es
para desarrollo local, nunca contra una base compartida.

### Lo que vive en SQL crudo

`prisma/migrations/0_init/migration.sql` termina con los objetos que el schema no expresa:

- `ck_consent_types_scope` — `CHECK (scope IN ('ONBOARDING'))`. Un `scope` nuevo para gatear
  operaciones de tu dominio = migración que reemplaza el CHECK.
- Trigger append-only de `audit_logs` (DELETE solo con
  `app.allow_audit_purge = true`, que usa `audit-archive.worker`).
- Los comentarios de tablas y columnas (`COMMENT ON …`).

---

## Seed

`prisma/seed.ts` corre, en orden, los módulos de `prisma/seeds/`: geografía (países, prefijos,
departamentos y ciudades de Colombia), catálogos (géneros, tipos de documento, roles RBAC, tipos de
consentimiento), configuración (config global, política de privacidad v1.0), notificaciones (categorías,
tipos y su categoría) y usuarios internos (SUPERADMIN con `SEED_ADMIN_*` y un ADMIN demo).

Regla: **crea lo que falta (por su clave natural: `code`, `name`, `version`…) y no modifica ni borra lo que
ya existe**. Así `db:seed` es seguro en cualquier momento — también en un despliegue con `RUN_SEEDS=true` — y
no pisa lo que se editó desde el admin. Única excepción: los **templates de los tipos de notificación**
(título, cuerpo, asunto y cuerpo del email), que la API no edita; si cambian en el seed, `db:seed` los
actualiza en la base.

- Dato nuevo (un tipo de notificación, un rol, un consentimiento) → se agrega en `prisma/seeds/` y se
  corre `npm run db:seed`.
- Cambiar un dato ya sembrado (salvo los templates) en bases existentes → migración con el `UPDATE`.

Usa el cliente de la app (`src/shared/database/prisma.ts`): necesita el `.env` completo y escribe la PII en
claro (la extensión de PII la cifra y calcula los hashes, como en cualquier repositorio).

---

## Por qué `db:reset` dropea el esquema

`scripts/db-reset.ts`:

```
DROP SCHEMA "<DB_SCHEMA>" CASCADE;  ← también borra _prisma_migrations (vive en el esquema)
CREATE SCHEMA "<DB_SCHEMA>";
npm run db:migrate   (prisma migrate deploy)
npm run db:seed      (prisma db seed)
```

No usa `prisma migrate reset` para conservar la guarda de `public` y aplicar exactamente lo mismo que un
despliegue.

---

## Bases creadas con Sequelize (baseline)

Hasta la fase 6 de la [migración a Prisma](prisma-migration.md) el esquema lo creaban 45 migraciones de
Sequelize (tracking en `SequelizeMeta`). `0_init` reproduce **exactamente** esa base — verificado objeto
por objeto (columnas, defaults, constraints, índices, enums, funciones, triggers y comentarios) contra un
esquema migrado con Sequelize y contra una base de desarrollo real.

En una base que ya tiene esas tablas, `0_init` no se ejecuta: `npm run db:migrate` (y por lo tanto el
entrypoint del contenedor) la **marca como aplicada** cuando encuentra `SequelizeMeta`:

1. Exige que estén las 45 migraciones de Sequelize. Si falta alguna, la base está detrás: hay que
   desplegar antes la última versión con Sequelize.
2. Si `SequelizeMeta` tiene migraciones que `0_init` no conoce (un proyecto derivado con migraciones
   propias), se detiene: ese proyecto necesita su propia migración base (ver abajo).
3. Renombra el único índice cuyo nombre dependía del esquema (`<esquema>_user_sessions_user_id_status` →
   `idx_user_sessions_user_id_status`).
4. `prisma migrate resolve --applied 0_init` y borra `SequelizeMeta`/`SequelizeData`.

Cada paso es idempotente: si se corta a mitad, volver a correr `db:migrate` lo completa.

Para revisar una base antes de desplegar, se compara contra un esquema recién creado con las migraciones:

```bash
DB_SCHEMA=baseline_check npm run db:migrate
npx tsx scripts/prisma-migration/compare-schemas.ts <tu_esquema> baseline_check
```

**Proyecto derivado con migraciones propias de Sequelize:** generá tu propia base en lugar de `0_init`
(`DB_SCHEMA=<esquema migrado> npx prisma migrate diff --from-empty --to-config-datasource --script`, sin el
calificador de esquema, más los objetos en SQL crudo de arriba), verificá con `compare-schemas.ts`, y
ajustá `SEQUELIZE_MIGRATIONS` en `scripts/db-migrate.ts`.

---

Relacionado: [`prisma-migration.md`](prisma-migration.md) (plan y estado de la migración a Prisma),
`docs/origin-session-tracking.md` (columnas de origen de sesión para tablas nuevas).
