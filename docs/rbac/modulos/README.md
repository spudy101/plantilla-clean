# Módulos del hub admin — binding autoritativo módulo ↔ routes ↔ RBAC ↔ roles

> **Fuente de verdad del backend.** Este set de documentos define, por agrupación de menú, qué **módulo
> RBAC** la gobierna, qué **routes** expone y **qué roles** la ven. Es autoritativo **desde el back**: el
> front **no** decide la estructura ni los permisos — se guía por lo que digamos acá.

## Cómo lo consume el front

El front **no hardcodea** qué ítems mostrar. Pinta el menú a partir de dos endpoints:

```
GET /kyc/iam/rbac/modules   → árbol de grupos (top-level + subgroups + módulos + labels)
GET /kyc/iam/rbac/me        → permisos del usuario logueado (solo authenticate, sin permiso)
```

Por cada ítem del menú, su `rbacModule` se contrasta contra `/rbac/me`: si el usuario no tiene al menos
`read` en ese módulo, el ítem no se pinta. El árbol y las agrupaciones viven en `RBAC_MODULE_GROUPS`
(`src/shared/domain/constants/rbac.ts`); estos docs explican cada grupo.

## Convenciones (comunes a todos los archivos)

- Prefijo omitido en las tablas: **`/admin/api/v1`** (todo el hub es app admin).
- `RBAC: <módulo>` = el `guards.requirePermission(RBAC_MODULES.<módulo>, <acción>)` de la ruta.
- Acciones RBAC: `create | read | update | delete`. En las tablas, "update" cubre PATCH/PUT de estado.
- **Roles del template base (4):** `SUPERADMIN`/`ADMIN` (acceso total; `ADMIN` sujeto a doble aprobación),
  `AUDITOR` (lectura global) y `CLIENTE` (externo, sin panel). Un proyecto derivado agrega roles finos y les
  concede los módulos que correspondan. Ver `docs/rbac/rbac.md`.

## Índice de agrupaciones

`RBAC_MODULE_GROUPS` define **6 agrupaciones top-level** que cubren los **19 módulos** RBAC:

| Agrupación (menú) | Grupo RBAC | Módulos | Doc |
|-------------------|------------|---------|-----|
| 🧑 Personas / Clientes | `clients` | clientsList, policyAcceptance | [01-personas-clientes.md](01-personas-clientes.md) |
| 🔌 Integraciones | `integrations` | integrationDashboard, apiLogs, providers | _sin doc dedicado — ver `rbac.js` + `docs/*` de integración_ |
| 📜 Auditoría | `audit` | globalLogs, auditActionCatalog, systemAlerts, userChanges, activeSessions | [06-auditoria.md](06-auditoria.md) |
| 🔔 Notificaciones | `notifications` | notificationDeliveries, notificationManagement | [07-notificaciones.md](07-notificaciones.md) |
| 🛡️ Consentimientos | `consents` | consentTypes, privacyPolicies | [08-consentimientos.md](08-consentimientos.md) |
| ⚙️ Administración del Sistema | `administration` (contenedor) → `rolesPermissions` · `internalUsers` · `dualApproval` · `systemConfig` · `promotionalContent` | 5 módulos de gobierno | [09-administracion-sistema.md](09-administracion-sistema.md) |

> El contenedor **Administración** no tiene módulos propios: agrupa visualmente a los 5 grupos de gobierno
> que lo referencian por `parent: 'administration'`. El anidamiento es solo de presentación.

## Alcance

Este set cubre el **hub admin**. Los endpoints `client` y compartidos (app del cliente, auth
self-service) son de otro frontend y no llevan módulo RBAC: su permiso es "estar autenticado". Varios de
esos endpoints compartidos **sí se montan también en la app admin** (sesión/dispositivos, MFA propio, perfil,
preferencias de notificación, campana, catálogos de maintainers), pero no tienen fila por módulo porque no
tienen módulo RBAC.
