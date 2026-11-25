# Base Project — API REST (plantilla Clean Architecture)

> **Versión Clean Architecture** de la plantilla base: misma API y funcionalidades, organizada en
> `domain → application → infrastructure / presentation` con un composition root en `src/main/`.
> Guía: [`docs/CLEAN-ARCHITECTURE.md`](docs/CLEAN-ARCHITECTURE.md). Migración terminada: `shared/` y los diez módulos
> (`settings`, `catalogs`, `banners`, `legal`, `integration`, `audit`, `person`, `notification`, `approvals` e `iam`) están en Clean.

> Plantilla base de API REST en Node.js para arrancar proyectos nuevos con el núcleo transversal ya
> resuelto y endurecido: **autenticación propia (JWT RS256 + sesiones), MFA, RBAC, doble aprobación
> (maker-checker), auditoría con trazabilidad por sesión, notificaciones multicanal y cifrado de PII**.
>
> Es una base **agnóstica de dominio y endurecida a nivel productivo**: trae solo la infraestructura
> transversal reutilizable, sin lógica de negocio acoplada. Al derivar un proyecto real, agregás tus
> propios módulos de dominio sobre esta base.

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-v4-blue.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v14+-blue.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-opcional-red.svg)](https://redis.io/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 📋 Tabla de contenidos

- [Qué incluye la base](#-qué-incluye-la-base)
- [Stack tecnológico](#️-stack-tecnológico)
- [Arquitectura](#️-arquitectura)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Ejecución](#-ejecución)
- [Requisitos previos](#-requisitos-previos)
- [Instalación](#-instalación)
- [Configuración (.env)](#️-configuración-env)
- [Base de datos](#️-base-de-datos)
- [Uso](#-uso)
- [Flujo de un request](#-flujo-de-un-request)
- [Seguridad](#-seguridad)
- [Testing](#-testing)
- [Documentación](#-documentación)
- [Convenciones](#-convenciones)
- [Licencia](#-licencia)

---

## ✨ Qué incluye la base

Todo lo transversal que un proyecto necesita el día 1, ya construido y probado:

### 🔐 Autenticación e identidad — [`docs/auth-sessions.md`](docs/auth-sessions.md)

- **Autenticación 100% propia** (sin proveedor externo): password validado contra hash en BD +
  **JWT RS256** propios (access 15 min / refresh 24 h, rotativo con detección de _reuse attack_).
- **Sesiones** con inactividad de 15 min (deslizante) y tope absoluto de 8 h; revocación quirúrgica por
  sesión o global; fallback a BD (`user_sessions`) si Redis no está.
- **MFA propio**: TOTP (RFC 6238, `otplib`) y SMS; método preferido configurable; **opt-in**.
- **Login biométrico** challenge-response ES256 (esquema propio, no WebAuthn/FIDO2).
- **Dispositivos de confianza**, reset de credenciales por email, blocklist de dispositivos.

### 🛡️ Autorización y control — RBAC + doble aprobación

- **RBAC** por módulo/acción (`create|read|update|delete`) con matriz base + overrides en runtime.
  Detalle: [`docs/rbac/rbac.md`](docs/rbac/rbac.md).
- **Doble aprobación (maker-checker)** genérica y declarativa para acciones sensibles: la operación
  queda `202 Accepted` hasta que un segundo funcionario la aprueba.
  Detalle: [`docs/dual-approval-global.md`](docs/dual-approval-global.md).

### 📝 Auditoría, alertas y trazabilidad — [`docs/audit-and-observability.md`](docs/audit-and-observability.md)

- `audit.record` → hechos de negocio append-only en `audit_logs`, escritos en la misma transacción que el
  cambio, con catálogo tipado y **alertas** para las acciones marcadas. Copia diaria a S3.
- **Traza de operaciones** → una fila por petición, webhook, ciclo de worker o tarea de sistema
  (`operations`), con el mismo `correlationId` que los logs y la auditoría.
- **Trazabilidad por sesión**: cada fila de dominio se ata a su sesión de origen (`origin_session_id`,
  automático). Timeline forense de "qué hizo el usuario en la sesión".
  Detalle: [`docs/origin-session-tracking.md`](docs/origin-session-tracking.md).

### 🔔 Notificaciones multicanal — [`docs/notifications.md`](docs/notifications.md)

- Canales: **email (SES)**, **push (SNS)**, **SMS (SNS)** e **in-app**. Punto de entrada único
  (el puerto `Notifier`: `notify` / `notifyEmail`), templates por tipo, categorías como fuente de verdad (canales, criticidad,
  layout de email), una preferencia por usuario (canales + horario de silencio), rate limiting y
  **reintentos automáticos** (despachador cada minuto, con detección de hard-bounce). Bandeja in-app con contador en vivo por **SSE**.

### 🔒 Cifrado y PII

- PII **cifrada at-rest** con AES-256-GCM + hash determinístico (HMAC) para búsqueda por igualdad.
  Detalle: [`docs/encryption-pii.md`](docs/encryption-pii.md).
- **Enmascaramiento automático** de identificadores en las respuestas de la API.
  Detalle: [`docs/pii-masking.md`](docs/pii-masking.md).

### 🏗️ Infraestructura transversal

- **Rate limiting** y **request locking** (store híbrido Redis + memoria, con fallback).
- **Idempotencia** de operaciones, **correlationId** por request de punta a punta.
- Manejo de errores centralizado (errores del dominio y técnicos traducidos a HTTP por un handler global),
  respuestas uniformes (`ApiResponse`).
- **Swagger/OpenAPI** autogenerado por servidor. Detalle: [`docs/swagger.md`](docs/swagger.md).
- **Workers** (cron) para expiración de sesiones, despacho de notificaciones, expiración de doble
  aprobación y archivado de auditoría.
- Consentimientos / política de privacidad, configuración global del sistema, banners promocionales.

---

## 🛠️ Stack tecnológico

| Área            | Tecnologías                                                                      |
| --------------- | -------------------------------------------------------------------------------- |
| **Runtime/Web** | Node.js 24+, TypeScript (estricto), Express 4                                     |
| **Datos**       | PostgreSQL 14+, Prisma 7 (`@prisma/adapter-pg`), `pg`                             |
| **Cache/estado**| Redis (`ioredis`) — **opcional**, con fallback a memoria/BD                       |
| **Auth**        | `jose` (JWT RS256), `bcryptjs`, `otplib` (TOTP)                                   |
| **AWS**         | SES (email), SNS (push/SMS), S3 (archivos), CloudFront                            |
| **Seguridad**   | `helmet`, `cors`, `express-rate-limit`                                            |
| **Validación**  | Zod (valida, tipa y genera OpenAPI)                                              |
| **Docs API**    | `swagger-ui-express`                                                              |
| **Jobs**        | `node-cron`                                                                       |
| **Media/otros** | `sharp`, `multer`, `geoip-lite`, `ua-parser-js`                                   |
| **Logging**     | `winston` + `winston-daily-rotate-file`                                           |
| **Dev/Test**    | `jest`, `supertest`, `nodemon`, `eslint`, `prettier`, `prisma` (CLI)            |

---

## 🏛️ Arquitectura

**Monolito modular**: un solo proceso y un solo despliegue, dividido en **módulos por dominio**. Cada módulo
es dueño de todo lo suyo (rutas, lógica, datos, workers, documentación) y ninguno importa a otro: lo que otro módulo
necesita lo pide por un puerto y `src/main/` lo conecta. `shared/` es lo transversal y no conoce el negocio.

**Clean Architecture:** dentro de cada módulo, el dominio y los casos de uso no conocen Prisma ni
Express; dependen de puertos (interfaces) que implementa la infraestructura, y `src/main/container.ts` conecta
todo. Guía: [`docs/CLEAN-ARCHITECTURE.md`](docs/CLEAN-ARCHITECTURE.md). **Léela antes de agregar código.**

### Flujo de un request

```
Request
  → [middlewares globales]   operación (id + contexto + traza) → seguridad → cookies → body-parse → compression
  → [middlewares de ruta]    Auth → RBAC → RateLimit → RequestLock → validate (Zod)
  → Controller → caso de uso → (puertos) → repositorio Prisma → PostgreSQL
  → ApiResponse   (o un error → handler global)
```

| Capa               | Responsabilidad                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **domain**         | entidades y reglas de negocio; errores que dicen qué regla se rompió. TypeScript puro.       |
| **application**    | casos de uso (orquestan: leen por puertos, auditan, avisan), puertos y DTOs de salida.       |
| **infrastructure** | implementa los puertos: repositorios Prisma + mappers, Redis, AWS, workers.                  |
| **presentation**   | rutas (factory), controllers, esquemas Zod de entrada y salida, docs OpenAPI.                |
| **src/main/**      | composition root: crea cada módulo con sus dependencias y conecta los módulos entre sí.      |

Detalle del pipeline: [`docs/request-flow.md`](docs/request-flow.md) · auditoría, operaciones y logs:
[`docs/audit-and-observability.md`](docs/audit-and-observability.md).

---

## 📁 Estructura del proyecto

```
.
├── src/
│   ├── main/                   # composition root: container (DI), adapters, app, server, swagger
│   ├── modules/                # un módulo por dominio: domain/ application/ infrastructure/ presentation/
│   │   ├── iam/                # usuarios, roles, RBAC, sesiones, login, MFA, biometría  ✅ Clean
│   │   ├── person/             # persona, contactos, ubicación, referencias, perfil  ✅ Clean
│   │   ├── catalogs/           # países, ciudades, géneros, tipos de documento, avatares  ✅ Clean
│   │   ├── notification/       # tipos, envío (email/SMS/push), preferencias, rebotes  ✅ Clean
│   │   ├── audit/              # auditoría, alertas, operaciones, bitácora de cambios  ✅ Clean
│   │   ├── legal/              # consentimientos, políticas de privacidad  ✅ Clean
│   │   ├── approvals/          # doble aprobación (maker-checker)  ✅ Clean
│   │   ├── settings/           # configuración global  ✅ Clean (molde para migrar el resto)
│   │   ├── banners/            # banners promocionales  ✅ Clean
│   │   └── integration/        # monitoreo de proveedores externos  ✅ Clean
│   └── shared/                 # kernel · domain · application (puertos) · infrastructure · presentation
│
├── prisma/                     # schema.prisma, migrations/, seed.ts + seeds/
├── scripts/                    # db-migrate, db-reset, generate-keys
├── tests/                      # helpers, integración, guardas de arquitectura (los unitarios van junto al código)
├── docs/                       # documentación técnica (ver §Documentación)
├── Dockerfile · entrypoint.sh
└── package.json
```

---

## 🚀 Ejecución

Un solo servidor expone las dos audiencias: `/admin/...` (panel) y `/client/...` (app), cada una con sus
políticas de autenticación y su Swagger (`/admin/docs`, `/client/docs`).

| | Comando |
|---|---|
| Desarrollo (hot-reload) | `npm run dev` |
| Producción | `npm run build` y luego `npm start` |

Prefijos de ruta bajo cada audiencia: `/api/v1/auth`, `/api/v1/kyc`, `/api/v1/notification`,
`/api/v1/records`, `/api/v1/core`, `/api/v1/integration`.

---

## 📦 Requisitos previos

- **Node.js** v24+
- **PostgreSQL** v14+
- **Redis** v7+ — _opcional_ (sin él, cache/rate-limit/locks caen a memoria/BD)
- Credenciales **AWS** (SES/SNS/S3) — opcionales en desarrollo (ver `MOCK_EXTERNAL_PROVIDERS`)

---

## 🚀 Instalación

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env        # y editar (ver §Configuración)

# 3. Generar las claves requeridas (JWT RS256 + AES) y pegarlas en el .env
npm run keys:generate

# 4. Crear el esquema, migrar y sembrar (ver §Base de datos)
npm run db:reset

# 5. Levantar
npm run dev
```

---

## ⚙️ Configuración (.env)

`.env.example` está documentado campo por campo. Lo mínimo para arrancar:

| Variable                              | Requerido | Notas                                                           |
| ------------------------------------- | :-------: | --------------------------------------------------------------- |
| `NODE_ENV`, `PORT` (def 4000), `HOST` |    —      | `PORT` lo usan los tres modos.                                  |
| `DB_HOST/PORT/NAME/USER/PASSWORD`     |    ✅     | PostgreSQL.                                                     |
| `DB_SCHEMA`                           |    ✅     | Esquema activo. **No usar `public`** (ver Base de datos).       |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`  |    ✅     | Par RS256 (PEM con `\n` literales). Sin ellas el arranque falla.|
| `AES_KEY` (+ `AES_IV`)                |    ✅     | Cifrado de PII. Generar con `npm run keys:generate`.            |
| `REDIS_*`                             |    —      | Opcional; sin config usa memoria local.                        |
| `AWS_*`, `SES_FROM_EMAIL`, `SNS_*`    |  parcial  | Requerido para notificar; en dev se puede mockear.             |
| `MOCK_EXTERNAL_PROVIDERS`             |    —      | Simula SMS/biométrico en dev (OTP fijo `123456`). Apagar en prod.|
| `ENABLE_WORKERS`                      |    —      | Habilita los cron workers.                                     |
| `SEED_ADMIN_*`                        |    —      | Datos del usuario admin inicial que crea el seed.              |

> **En producción** cargá las variables desde el entorno/gestor de secretos, no desde un `.env` en disco;
> usá HTTPS (la app respeta `trust proxy`); poné `CORS_ORIGIN` con dominios reales y
> `MOCK_EXTERNAL_PROVIDERS=false`.

---

## 🗄️ Base de datos

PostgreSQL + Prisma, con **aislamiento por esquema** (`DB_SCHEMA`): una misma instancia puede alojar
varios proyectos en esquemas distintos, y el historial de migraciones (`_prisma_migrations`) vive dentro
del esquema.

| Comando               | Qué hace                                                                    |
| --------------------- | --------------------------------------------------------------------------- |
| `npm run db:migrate`  | Aplica migraciones pendientes (`prisma migrate deploy`).                    |
| `npm run db:migrate:dev` | Genera una migración nueva desde `prisma/schema.prisma` (desarrollo).    |
| `npm run db:seed`     | Datos base; crea lo que falta y no pisa lo existente (`prisma db seed`).    |
| `npm run db:reset`    | **Dropea y recrea el esquema**, luego migra + seedea desde cero.            |
| `npm run db:fresh`    | Alias de `db:reset`.                                                        |

> ⚠️ `db:reset` es destructivo: dropea el esquema apuntado por `DB_SCHEMA`. Tiene una guarda que **aborta
> si `DB_SCHEMA` está vacío o es `public`**. Verificá siempre `DB_SCHEMA` antes de correrlo.

Para cambiar una tabla se edita `prisma/schema.prisma` y `npm run db:migrate:dev` genera la migración. Las
bases creadas con la versión Sequelize se adoptan solas en el primer `db:migrate` (baseline de `0_init`).
Detalle: [`docs/database.md`](docs/database.md).

---

## 💻 Uso

```bash
# Desarrollo (hot-reload)     Producción
npm run dev                   npm run build && npm start

# Calidad
npm run lint        # eslint .
npm run lint:fix    # eslint . --fix
npm run format      # prettier --write .
```

- **Health check**: `GET /health` (base de datos y Redis).
- **Docs Swagger**: `GET /admin/docs` y `GET /client/docs` (el JSON en `…/docs.json`).

---

## 🔀 Flujo de un request

Middlewares globales (orden crítico, en `src/main/app.ts`): operación (id + contexto + traza en `operations`) →
`helmet` → `cors` → headers de seguridad → `cookieParser` → `express.json` (10 MB) → captura de JSON
inválido → `compression`.

Middlewares de ruta (orden recomendado): `Auth` → `RBAC` → `RateLimit` → `RequestLock` → `validate(...)` →
controller.

Errores: el dominio y los casos de uso lanzan errores del dominio (`NotFoundError`, `ConflictError`…) y lo que
depende de algo externo, `ServiceUnavailableError`; nunca `throw 'string'` ni `AppError` (es HTTP: solo la
presentación lo usa). El `asyncHandler` reenvía al handler global, que los traduce, loguea, registra el error en la
operación y responde con estructura uniforme. Detalle completo: [`docs/request-flow.md`](docs/request-flow.md).

---

## 🔒 Seguridad

- **Headers** con Helmet (CSP, HSTS, `X-Frame-Options`, `nosniff`), CORS con whitelist.
- **Auth propia** JWT RS256; blacklist de tokens y umbrales de invalidación por sesión/usuario en Redis
  (fallback a BD). MFA TOTP/SMS opt-in. Inactividad 15 min + tope absoluto 8 h.
- **RBAC** por módulo/acción + doble aprobación (maker-checker) en acciones sensibles.
- **Input sanitization** (SQL/NoSQL injection, HPP), **rate limiting** y **request locking**.
- **PII**: cifrada at-rest (AES-256-GCM) y enmascarada en las respuestas por defecto.
- **Auditoría** append-only + alertas; logs nunca exponen password/token/PII.

Checklist de producción: rotar `JWT_*`/`AES_*`, `CORS_ORIGIN` real, HTTPS, `MOCK_EXTERNAL_PROVIDERS=false`,
Redis para rate-limit distribuido, backups de PostgreSQL, `ENABLE_WORKERS=true`.

---

## 🧪 Testing

```bash
npm run db:test:prepare  # una vez (y al cambiar migraciones): esquema `test` + migraciones
npm test                 # todos (jest, NODE_ENV=test)
npm run test:unit        # solo unit
npm run test:integration # solo integration
npm run test:coverage    # con cobertura
npm run test:watch       # watch
```

Tests en `tests/unit/**` y `tests/integration/**`. La suite corre con `--passWithNoTests` (la base trae un
smoke test del catálogo de modelos core; agregá los tuyos por feature).

Los **unitarios** mockean los repositorios y no necesitan base. Los de **integración** usan Postgres real
(la misma base de `.env`, pero en un esquema aislado: `TEST_DB_SCHEMA`, por defecto `test`, nunca `public`;
ver `tests/test-env.ts`). En CI corre un service container de Postgres (`.github/workflows/ci.yml`).

---

## 📚 Documentación

Toda la documentación técnica vive en [`docs/`](docs/). El README es el mapa; el detalle vive en cada guía:

| Doc | Qué cubre |
| --- | --------- |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **La guía de arquitectura:** estructura, capas, reglas y dónde va cada cosa. |
| [`getting-started.md`](docs/getting-started.md) | **Empieza aquí:** setup local, correr la app y checklist de rebranding para hacer tuya la plantilla. |
| [`request-flow.md`](docs/request-flow.md) | Pipeline de un request, middlewares, errores y `ApiResponse`, contexto de auditoría. |
| [`auth-sessions.md`](docs/auth-sessions.md) | Login, tokens JWT RS256, rotación de refresh, sesiones, inactividad/tope, códigos 401. |
| [`rbac/rbac.md`](docs/rbac/rbac.md) | Roles, módulos, matriz de permisos, overrides, middleware RBAC. |
| [`rbac/modulos/`](docs/rbac/modulos/) | Binding módulo ↔ routes ↔ roles (autoritativo para el front). |
| [`dual-approval-global.md`](docs/dual-approval-global.md) | Framework maker-checker: cómo funciona y cómo agregar operaciones. |
| [`audit-and-observability.md`](docs/audit-and-observability.md) | Auditoría (`audit.record`), traza de operaciones y logs: qué va en cada uno. |
| [`origin-session-tracking.md`](docs/origin-session-tracking.md) | `origin_session_id` y cómo extenderlo en tablas nuevas. |
| [`notifications.md`](docs/notifications.md) | Motor de notificaciones: categorías/tipos, canales, workers, preferencias, adjuntos. |
| [`encryption-pii.md`](docs/encryption-pii.md) | Cifrado at-rest (AES-256-GCM) + hash de búsqueda. |
| [`pii-masking.md`](docs/pii-masking.md) | Enmascaramiento de PII en las respuestas de la API. |
| [`dtos.md`](docs/dtos.md) | Respuestas (`responses/`): componentes, esquemas Zod de salida y prueba de conformidad. |
| [`solid.md`](docs/solid.md) | Principios SOLID aplicados: dónde está cada uno, checklist para features nuevos y camino a hexagonal. |
| [`implementation-patterns.md`](docs/implementation-patterns.md) | Plantillas canónicas de código por capa. |
| [`database.md`](docs/database.md) | Migraciones (Prisma Migrate), seed, aislamiento por esquema, `db:reset`, baseline de bases Sequelize. |
| [`swagger.md`](docs/swagger.md) | Estructura del OpenAPI y cómo documentar un módulo. |
| [`features-overview.md`](docs/features-overview.md) | Mapa de capacidades cliente vs admin y dónde vive cada una. |

---

## 📐 Convenciones

- **Capas**: domain → application (casos de uso + puertos) → infrastructure / presentation. Las reglas viven en el dominio.
- **Errores**: el dominio lanza `DomainError`; la presentación decide el status HTTP. Sin try/catch en controllers (usar `asyncHandler`).
- **Respuestas**: `ApiResponse` (camelCase, PII enmascarada, aplanado automático de listados).
- **Auditoría**: el puerto `AuditTrail` en el caso de uso por cada hecho de negocio, con `entityType`/`entityTable`.
- **Fronteras**: un módulo no importa otro (puertos + adaptadores de `src/main/`); `shared/` nunca importa `modules/`.
- **BD**: editar la migración original + `db:reset` (no acumular `ALTER TABLE`).
- **Swagger** en el mismo pase que el código.
- Estilo: **ES6+**, ESLint + Prettier, Conventional Commits.

---

## 📄 Licencia

MIT. Ver [LICENSE](LICENSE).
