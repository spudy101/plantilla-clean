# Trazabilidad por sesión — `origin_session_id` y cómo extenderla

> Cómo cada fila de dominio queda atada a la sesión de usuario que la creó, y qué hacer **cada vez que
> agregás una tabla nueva**. La superficie forense que consume esto (timeline de una sesión, entidades
> tocadas) está en `docs/audit-and-observability.md`; acá está la mecánica de escritura y la convención.

---

## La idea en una frase

Cada tabla de dominio lleva dos columnas nullable — **`origin_session_id`** (UUID) y
**`origin_correlation_id`** (STRING 128) — que se rellenan **solas al crear la fila** con la sesión y el
`correlationId` del request en curso. Son la **red de seguridad** (índice inverso fila → sesión): ante una
reclamación, la fila apunta a su sesión, y la sesión a su dispositivo, IP y ventana temporal.

> La **fuente** del timeline de una sesión es `audit_logs` (`session_id` + `entity_table`/`entity_id`), NO
> un fan-out sobre 50 tablas. `origin_session_id` es cobertura/durabilidad, no la fuente.

### Ojo con el nombre
- Tablas de **dominio** → **`origin_session_id`**.
- La tabla **`audit_logs`** usa **`session_id`** (no `origin_session_id`): ahí la sesión no es "el origen de
  una fila de negocio", es la dimensión propia del log. Por eso `user-activity.service` ramifica por fuente.

---

## Cómo se rellena (la extensión de Prisma)

`piiExtension` (`src/src/shared/database/prisma-extensions.ts`), aplicada al cliente único, completa
`originSessionId` y `originCorrelationId` al **crear** una fila de un modelo que los declara, desde
`requestContext.originFromContext()` (que lee el `sessionId`/`correlationId` del `AsyncLocalStorage`). El
`sessionId` lo inyecta al store `auth.middleware` tras autenticar, así que cualquier `create()` río abajo
lo hereda **sin pasar nada por parámetro**. Qué modelos los declaran sale de los metadatos que genera
`npm run prisma:generate` (`src/shared/database/generated/prisma-metadata.ts`).

Reglas:
- **Solo al CREAR, nunca al actualizar.** Un retry de admin o de worker corre en otro contexto y no debe
  pisar el origen real.
- **Un valor explícito del call-site siempre gana.** Login y biométrico pasan el `sessionId` recién creado a
  mano (el contexto todavía no lo tiene); la extensión ve el campo no-nulo y no lo toca.
- **`null` en workers/sistema y en flujos sin sesión** (registro público, "olvidé mi contraseña"): por eso
  las columnas son **nullable**.

---

## ✅ Checklist para una tabla NUEVA

1. **Schema** (`prisma/schema.prisma`): las dos columnas y su índice.
   ```prisma
   originSessionId     String? @map("origin_session_id") @db.Uuid
   originCorrelationId String? @map("origin_correlation_id") @db.VarChar(128)

   @@index([originSessionId], map: "idx_mi_tabla_origin_session_id")
   ```
2. **Migración**: `npm run db:migrate:dev -- --name <qué-cambia>` (ver [`database.md`](database.md#cambiar-el-esquema)).
3. **Listo.** La extensión las rellena sola (`npm run prisma:generate` actualiza los metadatos). No hace falta
   tocar ningún repositorio.

### ¿Cuándo NO ponerla?
Infra/sistema, catálogos y la sesión misma no la llevan: `audit_logs` (usa `session_id`), `audit_alerts`,
`user_sessions`, `sms_delivery_attempts`, `email_bounce_suppressions`, maintainers
(país/ciudad/…), `notification_categories`/`notification_types`, `roles`, `consent_types`, `privacy_policies`.
**`users` tampoco**: sus cambios se trazan en la bitácora de cambios (`USER_FIELD_CHANGED` en `audit_logs`, que lleva `session_id`);
duplicarlo en `users` sería redundante.

---

## Ver "qué hizo el usuario en la sesión" con detalle (ENTITY_REGISTRY)

El timeline forense (`GET /records/audit/sessions/:id`) sale de `audit_logs`. Para **hidratar** el detalle
de las filas referenciadas (`GET /records/audit/sessions/:id/entities`), el service
`src/modules/audit/services/admin-session-trace.service.ts` tiene un `ENTITY_REGISTRY` que mapea
`entity_table → { repository, pk, entityType, dto }`. Las tablas no registradas caen en `skipped`.

Hoy registra: `user_consents`, `user_notification_preferences`, `user_trusted_devices`.

**Para hidratar una tabla más:**
1. Asegurate de que sus `audit.record` sellen **`entityId`** + **`entityTable`** (sin
   `entityId` no hidrata).
2. Escribí un component DTO que **enmascare/omita PII** (esta vista NO es self-view). Los componentes viven
   en `src/modules/audit/responses/audit-components.response.ts` (ej. `NotificationPreferenceComponent`).
3. Sumá la entrada al `ENTITY_REGISTRY`:
   ```js
   mi_tabla: { repository: miRepo, pk: 'mi_tabla_id', entityType: 'MiEntidad', dto: r => MiComponent.build(r) }
   ```

> PII: si la tabla tiene dirección, teléfono o tokens, **enmascará u omití** esos campos en el component.
> Por eso `person_locations` y `credential_resets` no están registradas todavía (dirección/token sensibles).

---

## Verificación rápida

```sql
-- Tablas del esquema que YA llevan la columna:
SELECT table_name FROM information_schema.columns
WHERE table_schema = 'plantilla' AND column_name = 'origin_session_id' ORDER BY table_name;
```
Relacionados: `docs/auth-sessions.md` (control de sesiones), `docs/audit-and-observability.md` (superficie forense).
