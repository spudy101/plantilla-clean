# ⚙️ Administración del Sistema

> **Grupos RBAC:** `rolesPermissions` · `internalUsers` · `dualApproval` · `systemConfig` · `promotionalContent`
> **Prefijo omitido:** `/admin/api/v1` · Parte del mapeo de módulos del hub admin. Ver [README](README.md).

## La idea

Los módulos de **gobierno del sistema**. En vez de dejarlos como ítems top-level sueltos, se agrupan bajo un
solo contenedor visual "⚙️ Administración" (`administration`, sin módulos propios; los grupos hijos lo
referencian por `parent`). El anidamiento es solo de presentación — los grupos RBAC quedan planos.

**Estructura de navegación:**
```
⚙️ Administración  (contenedor, sin módulos propios)
├─ 🔑 Roles y Permisos       → rolesPermissions
├─ 👤 Usuarios Internos      → internalUsers
├─ 🔒 Doble Aprobación       → dualApproval
├─ ⚙️ Configuración Global   → systemConfig
└─ 📢 Banners Promocionales  → promotionalContent
```

---

## 🔑 Roles y Permisos — `RBAC: rolesPermissions`
```
GET    /kyc/iam/rbac/modules                                    (read — árbol de grupos + módulos)
GET    /kyc/iam/rbac/roles                                       (read)
GET    /kyc/iam/rbac/roles/:roleName/permissions                 (read)
POST   /kyc/iam/rbac/roles/:roleName/permissions                 (create — agrega un override)
DELETE /kyc/iam/rbac/roles/:roleName/permissions/:permissionId   (delete — revoca un override)
```
🔑 **Endpoint clave para TODO el front (solo `authenticate`, sin permiso):**
```
GET    /kyc/iam/rbac/me    → permisos del usuario logueado
```
Es lo que el front usa para construir la navegación: cada `rbacModule` del menú se contrasta contra lo que
devuelve `/rbac/me`. Los `POST`/`DELETE` de permisos gestionan **overrides en runtime** (`RolePermissionOverride`),
que solo suman sobre la matriz base. Ver `docs/rbac/rbac.md`.

## 👤 Usuarios Internos — `RBAC: internalUsers`
```
GET    /kyc/iam/users                            (read — listado)
GET    /kyc/iam/users/deleted                    (read — eliminados)
GET    /kyc/iam/users/roles                       (read — catálogo de roles internos)
GET    /kyc/iam/users/:userId                     (read — ficha)
POST   /kyc/iam/users                             (create)
PATCH  /kyc/iam/users/:userId                     (update — datos)
PATCH  /kyc/iam/users/:userId/role                (update — **doble aprobación** `RBAC_ROLE_CHANGE` → 202)
PATCH  /kyc/iam/users/:userId/status              (update — activar/desactivar)
DELETE /kyc/iam/users/:userId/delete-account      (delete — **doble aprobación** `INTERNAL_USER_DELETE` → 202)
GET    /kyc/iam/users/:userId/sessions            (read — sesiones del usuario)
DELETE /kyc/iam/users/:userId/sessions            (delete — cerrar sus sesiones)
GET    /kyc/iam/users/:userId/change-logs         (read — historial de cambios)
```

## 🔒 Doble Aprobación — `RBAC: dualApproval`  *(dominio `core`)*
```
GET    /core/approval-requests            (read — solicitudes pendientes/resueltas)
GET    /core/approval-requests/policy     (read — operaciones gateadas + umbrales)
GET    /core/approval-requests/:id        (read — detalle)
POST   /core/approval-requests/:id/resolve (update — aprobar/rechazar; valida rol aprobador + segregación)
```
Detalle del framework: `docs/dual-approval-global.md`.

## ⚙️ Configuración Global — `RBAC: systemConfig`  *(dominio `core`)*
```
GET    /core/system-config     (read — parámetros globales activos)
PATCH  /core/system-config     (update — retención, resiliencia, umbrales, etc.)
```

## 📢 Banners Promocionales — `RBAC: promotionalContent`  *(dominio `core`)*
```
GET    /core/promotional-banners           (read — catálogo completo, incluye inactivos)
PUT    /core/promotional-banners           (update — reemplaza el catálogo)
POST   /core/promotional-banners/image     (create — multipart "image" → S3 público/CloudFront)
```
La data vive en `system_global_config.promotional_banners` (JSONB). **El consumo del front es público**
(fuera del hub RBAC): `GET /client/api/v1/core/promotional-banners` (sin auth, solo banners activos) — lo
usan la landing y la app del cliente.

---

## Quién lo ve

En el template base: `SUPERADMIN`/`ADMIN` (acceso total; `SUPERADMIN` además omite la doble aprobación y
`ADMIN` la respeta) y `AUDITOR` (solo lectura). Los checkers de doble aprobación son los roles con
`dualApproval:update` (en la base, `ADMIN`; los wildcard siempre pueden resolver).
