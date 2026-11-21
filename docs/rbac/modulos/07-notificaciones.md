# 🔔 Notificaciones

> **Grupo RBAC:** `notifications` · **Prefijo omitido:** `/admin/api/v1`
> Parte del mapeo de módulos del hub admin. Ver [README](README.md).

## La idea

Antes era un ítem suelto (`notificationManagement`) + una pieza mal ubicada dentro de Auditoría (el
reenvío). Se consolidan en un **grupo propio** con 2 partes: gestión de tipos + consulta de entregas.

**Estructura:**
```
🔔 Notificaciones  (grupo)
├─ Tipos / Gestión           → notificationManagement
└─ Entregas (consulta)       → notificationDeliveries (⬅️ SALE de Auditoría)
```

---

## Tipos / Gestión — `RBAC: notificationManagement`
```
GET    /notification/notification-types
POST   /notification/notification-types/global · /direct   (create)
PATCH  /notification/notification-types/:notificationTypeId (update)
```

## Entregas — `RBAC: notificationDeliveries`  *(era "Notificaciones SMS" dentro de Auditoría)*
```
GET    /notification/notification-delivery[/:id]           (read — solo consulta)
```

*Quién:* notificationManagement → admins; notificationDeliveries → soporte (`read`).
No hay reenvío manual (2026-11-19): los reintentos son automáticos (docs/notifications.md). El módulo se
llamaba `notificationResend`; la migración `20261119140000_notification_deliveries` renombró los permisos.

---

## Decisiones del módulo

| # | Acción | Detalle | Estado |
|---|--------|---------|--------|
| 1 | notificationResend (hoy notificationDeliveries) sale de Auditoría | Se une a Notificaciones (mismo grupo RBAC `notifications`). | ✅ |
| 2 | Notificaciones = grupo | Deja de ser ítem suelto; 2 partes: Gestión + Entregas. | ✅ |
