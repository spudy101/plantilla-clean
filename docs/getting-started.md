# Getting Started

Guía para arrancar un proyecto nuevo a partir de esta plantilla. Cubre el setup local y el
**checklist de rebranding** para hacerla tuya (esta base viene con el nombre neutro `base-project`).

Para entender qué trae el núcleo, ver [`features-overview.md`](./features-overview.md). Para los tres
.

---

## 1. Requisitos

- **Node.ts 24** LTS (la imagen de producción es `node:24-alpine`; ver `.nvmrc`). El código es
  TypeScript en migración gradual: ver [`typescript-migration.md`](typescript-migration.md).
- **PostgreSQL** (la app usa un esquema configurable vía `DB_SCHEMA`; por defecto `public`).
- **Redis** — opcional. Sin él, el cache y el rate-limit degradan a memoria por instancia.
- Cuenta **AWS** (SES/S3/SNS) para correo, almacenamiento y push. En local se pueden mockear
  proveedores externos con `MOCK_EXTERNAL_PROVIDERS=true` (default fuera de producción).

## 2. Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Crear tu .env a partir del ejemplo
cp .env.example .env

# 3. Generar las llaves de cifrado y JWT (rellena AES_KEY, AES_IV, HASH_PEPPER, JWT_*)
npm run keys:generate

# 4. Completar en .env las variables REQUERIDAS: DB_*, AWS_*, FRONTEND_RESET_URL
#    (la app valida la config al arrancar y aborta si falta algo obligatorio)

# 5. Crear el esquema y datos base
npm run db:migrate
npm run db:seed
# — o, para recrear todo desde cero (dropea y recrea el esquema):
npm run db:reset
```

> ⚠️ `db:reset` dropea el esquema apuntado por `DB_SCHEMA`. Nunca lo corras contra un esquema
> compartido con otro proyecto o contra `public` en una BD con datos que no son tuyos.

## 3. Correr la app

Un solo modo a la vez (todos usan el mismo `PORT`):

```bash
npm run dev          # Monolito: Cliente + Admin
```

Swagger: `http://localhost:<PORT>/admin/docs` y `/client/docs`.

## 4. Calidad

```bash
npm run db:test:prepare  # una vez: esquema `test` aislado + migraciones (los tests de integración usan Postgres)
npm test             # Jest
npm run lint         # ESLint
npm run format       # Prettier
```

---

## 5. Checklist de rebranding

La base es funcional con nombre neutro. Para adaptarla a tu proyecto, revisa cada punto:

### Identidad del proyecto
- [ ] `package.json` → `name` (`base-project`) y `version`.
- [ ] `src/shared/constants/index.ts` → `SECURITY.TOTP_ISSUER` (`'BaseProject'`): es el emisor que
      aparece en las apps de autenticación (Google Authenticator, etc.).
- [ ] `src/config/swagger.admin.ts` y `src/config/swagger.client.ts` → `info.title`, `info.description`,
      `info.contact`, y las URLs de `servers`.
- [ ] `Dockerfile`, config de CI y SonarQube (si aplican) → nombre de imagen/proyecto.

### Variables de entorno (`.env`)
- [ ] `CORS_ORIGIN` → dominios de tu frontend.
- [ ] `AWS_*`, `BUCKET_NAME`, `S3_PUBLIC_BUCKET_NAME`, `CLOUDFRONT_*` → tus recursos.
- [ ] `SES_FROM_EMAIL`, `LOGO_URL`, `PRIVACY_POLICY_URL` → branding de correos y assets públicos.
- [ ] `SNS_PLATFORM_ARN_IOS` / `SNS_PLATFORM_ARN_ANDROID` → tus plataformas de push.
- [ ] `FRONTEND_RESET_URL` → URL de tu flujo de recuperación de contraseña.
- [ ] `SEED_ADMIN_*` → datos del admin inicial que crea el seed.

### Datos semilla (`prisma/seeds/`)
- [ ] `catalogs.seed.ts` (consentimientos) → ajusta los consentimientos (`PRIVACY_POLICY`,
      `COMUNICACIONES_COMERCIALES`) y agrega los propios de tu dominio.
- [ ] `catalogs.seed.ts` (tipos de documento, roles…) y `geography.seed.ts` → adapta al país/negocio si hace falta.
- [ ] `notification-types/` y `data/notification-categories.ts` → mensajes y canales por defecto.

### Infra
- [ ] La infraestructura (IaC) vive en un repo aparte. En producción, los secrets (llaves de cifrado,
      JWT) y las URLs de assets (CloudFront) los provee ese pipeline vía Secrets Manager / variables de
      entorno — no se ponen a mano en `.env`. Ajusta ahí los nombres de recursos por entorno.

---

## 6. Cómo extender con tu dominio

- **Nuevo módulo de negocio:** crea tu carpeta bajo `modules/<client|admin|schemas>/...` siguiendo
  la convención existente (model → repository → service → controller → routes → dto). Ver
  [`implementation-patterns.md`](./implementation-patterns.md).
- **Trazabilidad por sesión:** si tu entidad debe registrar quién/qué sesión la creó, declara la
  columna `origin_session_id` (la extensión del cliente de Prisma la rellena sola al crear) y súmala al
  `ENTITY_REGISTRY` del session-trace. Ver [`origin-session-tracking.md`](./origin-session-tracking.md).
- **Consentimientos:** agrega nuevos `scope` a la tabla `consent_types` (y su CHECK) para gatear
  operaciones de tu dominio; usa `ConsentMiddleware.requireConsent(code)` en la ruta.
- **Doble aprobación (maker-checker):** engancha operaciones sensibles al flujo de
  `approval-request`. Ver [`dual-approval-global.md`](./dual-approval-global.md).
- **RBAC:** define permisos y asígnalos a roles. Ver [`rbac/rbac.md`](./rbac/rbac.md).
- **Notificaciones:** registra tipos y plantillas por categoría/canal. Ver
  [`notifications.md`](./notifications.md).
