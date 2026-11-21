# 📜 Auditoría

> **Grupo RBAC:** `audit` · **Prefijo omitido:** `/admin/api/v1`
> Parte del mapeo de módulos del hub admin. Ver [README](README.md).

## La idea

Auditoría reúne todo lo forense y de seguridad del sistema: los logs globales (append-only), su catálogo de
acciones, las alertas, el historial de cambios de usuario y las sesiones activas. El grupo `audit` tiene
**5 módulos**.

**Estructura:**
```
📜 Auditoría  (grupo)
├─ Logs Globales                → globalLogs          (incluye la traza forense de sesión)
├─ Catálogo de Acciones         → auditActionCatalog  (alimenta los filtros de Logs Globales)
├─ Alertas del Sistema          → systemAlerts
├─ Cambios de Usuarios          → userChanges
└─ Sesiones Activas             → activeSessions      (dominio `auth`)
```

---

## Logs Globales — `RBAC: globalLogs`
```
GET  /records/audit/audit-logs                     (read — listado paginado con filtros)
GET  /records/audit/audit-logs/export              (read — exportar)
GET  /records/audit/audit-logs/:auditLogId         (read — detalle)
```
Traza forense de sesión (el consumidor de `origin_session_id`, también `globalLogs` READ):
```
GET  /records/audit/sessions                       (read — listado + conteo de acciones por sesión)
GET  /records/audit/sessions/:sessionId            (read — cabecera + timeline cronológico de audit_logs)
GET  /records/audit/sessions/:sessionId/entities   (read — hidratación por lote de las filas de dominio de la sesión)
```
> **No confundir con Sesiones Activas (`activeSessions`, dominio `auth`).** Esa es *control* (ver activas,
> revocar). Esta es *investigación*: qué se hizo en una sesión y contra qué filas. El timeline sale de
> `audit_logs`. Detalle: `docs/audit-and-observability.md` y `docs/origin-session-tracking.md`.

## Catálogo de Acciones de Auditoría — `RBAC: auditActionCatalog`
```
GET  /records/audit/audit-action-catalog/categories   (read)
GET  /records/audit/audit-action-catalog/risks         (read)
GET  /records/audit/audit-action-catalog/modules       (read)
GET  /records/audit/audit-action-catalog/actions       (read)
```
Alimenta los filtros de Logs Globales (no es un ítem de menú por sí solo).

## Alertas del Sistema — `RBAC: systemAlerts`
```
GET    /records/audit/audit-alerts                        (read)
PATCH  /records/audit/audit-alerts/:alertId/acknowledge   (update)
POST   /records/audit/audit-alerts/acknowledge-bulk       (update)
```

## Cambios de Usuarios — `RBAC: userChanges`
```
GET  /records/audit/change-logs/users   (read — historial antes/después de cambios sobre usuarios)
```

## Sesiones Activas — `RBAC: activeSessions`  *(dominio `auth`)*
```
GET    /auth/sessions                        (read — sesiones activas)
GET    /auth/sessions/user/:userId           (read — sesiones de un usuario)
PATCH  /auth/sessions/:sessionId/revoke      (update — revocación quirúrgica por admin)
GET    /auth/attempts                        (read — intentos de login)
GET    /auth/attempts/user/:userId           (read — intentos de un usuario)
```

---

## Quién lo ve

En el template base: `AUDITOR` (lectura de todo el grupo), `SUPERADMIN`/`ADMIN` (acceso total, incluido el
`update` de acknowledge de alertas y la revocación de sesiones). Un proyecto derivado puede agregar un rol
de seguridad con `activeSessions`/`systemAlerts` update.
