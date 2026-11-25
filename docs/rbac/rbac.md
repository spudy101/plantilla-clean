# RBAC — control de acceso basado en roles — guía de onboarding

> Cableado en rutas: ver `docs/request-flow.md`.
> Matriz y constantes: `src/shared/domain/constants/rbac.ts`. Resolución: `src/modules/iam/domain/rbac.ts` (reglas) y `PermissionResolver` en `src/modules/iam/application/use-cases/rbac.use-cases.ts`.
> Guarda: `requirePermission` en `src/modules/iam/presentation/http/auth.guards.ts` (las demás rutas la reciben por `src/main/adapters/route-guards.adapter.ts`).

> **Binding módulo ↔ routes ↔ roles (autoritativo desde el back):** `docs/rbac/modulos/` — un `.md` por
> agrupación de menú. Cada uno define, para su grupo de `RBAC_MODULE_GROUPS`, qué módulo lo gobierna, qué
> routes expone y qué roles lo ven. **El front no decide la estructura ni los permisos: se guía por estos
> documentos** y reconstruye su navegación desde `GET /kyc/iam/rbac/me` + `GET /kyc/iam/rbac/modules`.
> Índice: `docs/rbac/modulos/README.md`.

## Conceptos

- **Roles** (`RBAC_ROLES`, **4** en el template base):
  - `SUPERADMIN` — acceso total (`*`) y **omite la doble aprobación** (la auto-aprueba).
  - `ADMIN` — acceso total (`*`) pero **sí** sujeto a doble aprobación en operaciones sensibles.
  - `AUDITOR` — **solo lectura** en todos los módulos (`{ '*': ['read'] }`).
  - `CLIENTE` — rol **externo** (portal cliente); sin acceso al panel admin (`{}`).
  El valor de cada rol es el `name` exacto guardado en la tabla `roles`. Un proyecto derivado agrega sus
  roles (y sus permisos) aquí; esta base intencionalmente trae el mínimo.
- **Módulos** (`RBAC_MODULES`, **19**): un módulo por sección/recurso del panel admin (id plano camelCase,
  en inglés). Agrupados para el front en `RBAC_MODULE_GROUPS`. Los 19:
  - **Administración:** `rolesPermissions`, `internalUsers`, `dualApproval`, `systemConfig`, `promotionalContent`.
  - **Clientes:** `clientsList`, `policyAcceptance`.
  - **Integraciones:** `providers` (salud de proveedores e historial de caídas; las métricas por llamada están en CloudWatch).
  - **Auditoría:** `globalLogs`, `auditActionCatalog`, `systemAlerts`, `userChanges`, `activeSessions`.
  - **Notificaciones:** `notificationDeliveries`, `notificationManagement`.
  - **Consentimientos:** `consentTypes`, `privacyPolicies`.
- **Acciones** (`RBAC_ACTIONS`): `create | read | update | delete` (`ALL_ACTIONS` = las 4).
- **Wildcard** (`RBAC_WILDCARD = '*'`): como valor de rol → acceso total; como módulo (`{ '*': ['read'] }`)
  → esa acción en cualquier módulo.

## Matriz base (`ROLE_PERMISSIONS`)

En el template la matriz es deliberadamente mínima (la lógica fina de un proyecto real se agrega derivando):

```js
const ROLE_PERMISSIONS = {
  [RBAC_ROLES.SUPERADMIN]: RBAC_WILDCARD,          // acceso total; omite doble aprobación
  [RBAC_ROLES.ADMIN]:      RBAC_WILDCARD,          // acceso total; sujeto a doble aprobación
  [RBAC_ROLES.AUDITOR]:    { [RBAC_WILDCARD]: [READ] }, // lectura global
  [RBAC_ROLES.CLIENTE]:    {}                       // sin permisos de panel (mínimo privilegio)
};
```

Formato por rol:

- `RBAC_WILDCARD` → acceso total e irrestricto. **Lo tienen `SUPERADMIN` y `ADMIN`. Nunca modificarlos.**
- `{ '*': ['read'] }` → esas acciones en cualquier módulo (así se define `AUDITOR`).
- `{ [modulo]: [acciones] }` → acciones permitidas por módulo (para roles finos que agregues).
- `{}` → sin permisos (mínimo privilegio). Los roles externos (`CLIENTE`).

> **Por qué la matriz base vive en código y no en BD:** los permisos base de un rol son *esquema* — solo
> cambian cuando el negocio redefine el rol, y eso amerita deploy + revisión. En código quedan inmutables,
> versionados en git e imposibles de corromper en caliente. La capa granular editable en runtime son los
> **overrides** (abajo), que se fusionan sobre esta base dentro de `PermissionResolver.can()`.

## Clasificación de roles (helpers exportados de `rbac.js`)

- `EXTERNAL_ROLE_NAMES` = `[CLIENTE]` — externos.
- `INTERNAL_ROLE_NAMES` = todos los que no son externos (`SUPERADMIN`, `ADMIN`, `AUDITOR`) — se usa para la
  **inactividad de sesión de 15 min** y para el **gate de 2FA** (`isInternalRole`, en `modules/iam/domain/user.ts`).
- `CLIENT_ROLE_NAMES` = `[CLIENTE]` — a quiénes lista `admin-person.list` y a quiénes llega la notificación global.
- `ADMIN_FULL_ACCESS_ROLES` = `[SUPERADMIN, ADMIN]` — acceso completo al panel.
- `SUPERADMIN_ROLE_NAMES` = `[SUPERADMIN]` — fuente única del bypass de doble aprobación.
- `ADMIN_NOTIFICATION_ROLE_NAMES` = `[SUPERADMIN, ADMIN]` — destinatarios de las notificaciones "al admin".

## Resolución — `PermissionResolver.can(roleName, module, action)`

Las reglas son funciones puras de `modules/iam/domain/rbac.ts` (`grantedByBase`, `can`, `effectivePermissions`,
`roleMatrixEntry`); `PermissionResolver` (`modules/iam/application/use-cases/rbac.use-cases.ts`) les agrega los
overrides de la base, con su caché:

1. Si el rol no existe en la matriz → `false`.
2. Si su valor es `RBAC_WILDCARD` → `true`.
3. Si la matriz base concede el `[module][action]` o el `['*'][action]` → `true`.
4. Si no, consulta **overrides en runtime** (`RolePermissionOverride` en BD, cacheados en Redis 60 s,
   key `rbac:overrides:v2:{roleName}`) → `true` si existe `{ role_name, module_name, action }`.
   Fail-open: si Redis no está, se consulta BD directo.

Otros métodos: `effectivePermissions` (matriz normalizada por módulo), `matrix` (base vs added, para la UI) e
`invalidate(roleName)` (lo llaman `GrantPermission` / `RevokePermission` al crear o borrar un override). El catálogo
(grupos + módulos + acciones para el front) es `permissionCatalog()` del dominio.

## Guarda — `guards.requirePermission(module, action)`

Las rutas reciben las guardas (`RouteGuards`) por parámetro; las implementa iam
(`modules/iam/presentation/http/auth.guards.ts`, con el caso de uso `AuthorizePermission`):

```ts
router.post('/internal-users',
  guards.authenticate,                                                  // primero (pobla req.user.roleName)
  guards.requirePermission(RBAC_MODULES.INTERNAL_USERS, RBAC_ACTIONS.CREATE),
  ...);
```

- Verifica `req.user.roleName`; llama `PermissionResolver.can(...)`; si `false` → `IamForbiddenError` (403).
- **Gate de 2FA:** si el rol es interno (`isInternalRole`) y no tiene MFA activo (`hasActiveMfa`) →
  `MfaRequiredError` (403, `details: { code: 'MFA_REQUIRED' }`) — el front debe redirigir a setup de MFA, no
  tratarlo como "sin permiso".
- ❌ En rutas admin usar SIEMPRE RBAC (no `guards.requireRole`).
- ✅ El (módulo, acción) debe calzar semánticamente con lo que hace el endpoint.

## Overrides en runtime — `RolePermissionOverride`

Tabla `role_permission_overrides` (`role_name`, `module_name`, `action`, `granted_by_user_id`). Permite que
el Superadmin **agregue** permisos sobre la base en runtime, sin tocar código. **Solo suma; nunca reduce**
la base (mínimo privilegio). Al modificarlos se invalida la caché del rol (`PermissionResolver.invalidate`).

## Agrupaciones (`RBAC_MODULE_GROUPS`) — árbol para el front

`permissionCatalog()` devuelve los grupos tal cual. Cada grupo: `{ key, label, description, modules: [{ id, label,
description }] }`. Algunos grupos declaran `parent: 'administration'` para colgar de un contenedor de menú.

**Top-level:** `clients`, `integrations`, `audit`, `notifications`, `consents` y el contenedor
`administration` (sin módulos propios), que agrupa a `rolesPermissions`, `internalUsers`, `dualApproval`,
`systemConfig` y `promotionalContent`. El anidamiento (`parent`) es **solo de presentación**: la resolución
de permisos siempre lee los ids de módulo planos.

## Agregar un módulo o rol

1. **Módulo:** agregar el id a `RBAC_MODULES` (camelCase, en inglés) y mapearlo en su grupo de
   `RBAC_MODULE_GROUPS` (`{ id, label, description }`). Usarlo en la ruta con
   `guards.requirePermission(RBAC_MODULES.X, RBAC_ACTIONS.Y)`.
2. **Rol:** agregar el `name` a `RBAC_ROLES`, su entrada en `ROLE_PERMISSIONS` (mínimo privilegio: conceder
   solo los módulos/acciones que necesita) y, si es interno, se sumará solo a `INTERNAL_ROLE_NAMES`
   (inactividad + 2FA) por el `filter` de externos.
3. **Reflejarlo en `docs/rbac/modulos/<agrupación>.md`** (el binding módulo↔routes↔roles que consume el
   front): agregar el módulo, sus routes y quién lo ve. Son la fuente de verdad del back.
4. No tocar los roles wildcard (`SUPERADMIN`/`ADMIN`) ni dar módulos de panel a roles externos (`CLIENTE`).
