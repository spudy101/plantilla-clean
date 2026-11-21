# 🧑 Personas / Clientes

> **Grupo RBAC:** `clients` · **Prefijo omitido en tablas:** `/admin/api/v1`
> Parte del mapeo de módulos del hub admin. Ver [README](README.md).

## La idea

Todo lo que gestiona a **la persona/cliente final** vive aquí: su ficha, el estado de su cuenta, sus
credenciales y las políticas que aceptó. En el template base el grupo `clients` tiene **2 módulos**:
`clientsList` (gestión del cliente) y `policyAcceptance` (historial de consentimientos por cliente).

---

## 1. Clientes — listado, ficha y gestión de cuenta
`RBAC: clientsList` — read (listado/ficha) · create/update/delete (gestión)

| Método | Path | Acción |
|--------|------|--------|
| GET | `/kyc/person` | read — listado paginado (`search`, `isActive`, `roleId`) |
| GET | `/kyc/person/deleted` | read — histórico read-only de cuentas eliminadas |
| GET | `/kyc/person/roles` | read — catálogo de roles CLIENTE (para el filtro) |
| GET | `/kyc/person/:userId` | read — ficha del cliente (persona + contacto + ubicación + referencias) |
| POST | `/kyc/person` | create — alta de cliente por gestión |
| PUT | `/kyc/person/:userId/activate` | update |
| PUT | `/kyc/person/:userId/deactivate` | update |
| PUT | `/kyc/person/:userId/reset-password` | update |
| PUT | `/kyc/person/:userId/disable-mfa` | update |
| PUT | `/kyc/person/:userId/email` | update |
| PUT | `/kyc/person/:userId/national-id` | update — corrección del documento (potestad admin; para el propio cliente es inmutable) |
| PUT | `/kyc/person/:userId/role` | update — **doble aprobación** (`RBAC_ROLE_CHANGE`) → responde **202** |
| DELETE | `/kyc/person/:userId/delete-account` | delete — pide password del admin + **doble aprobación** (`CLIENT_ACCOUNT_DELETE`) → **202** |

> El cambio de rol y la eliminación de cuenta pasan por el framework de cuatro ojos: responden `202` y se
> resuelven en `/core/approval-requests`. Ver [09-administracion-sistema.md](09-administracion-sistema.md)
> y `docs/dual-approval-global.md`.

## 2. Aceptación de Políticas
`RBAC: policyAcceptance` — read

| Método | Path | Acción |
|--------|------|--------|
| GET | `/records/legal/user-consents` | read — aceptaciones de todos los clientes |
| GET | `/records/legal/user-consents/users/:userId` | read — aceptaciones de un cliente |

✅ Historial de aceptaciones **por cliente** → bien en Personas. Las *definiciones* (tipos de consentimiento
y políticas de privacidad) viven en [Consentimientos](08-consentimientos.md).

---

## Quién lo ve

En el template base, con 4 roles: `SUPERADMIN` y `ADMIN` (acceso total, sujeto a doble aprobación donde
aplica) y `AUDITOR` (solo lectura). Un proyecto derivado que agregue roles operativos (analistas, atención
al cliente, etc.) les concede `clientsList`/`policyAcceptance` con las acciones que correspondan.
