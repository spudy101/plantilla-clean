# Sistema de Notificaciones — guía de onboarding

> El detalle vive aquí.
> Punto de entrada único: el puerto **`Notifier`** (`shared/application/ports/notifier.port.ts`): `notify({ type, userId, … })`
> y `notifyEmail({ type, email, … })`. Lo implementa el caso de uso `CreateNotification`
> (`src/modules/notification/application/use-cases/create-notification.use-case.ts`); `src/main/container.ts` lo
> conecta a cada módulo (iam incluido).

## Idea general

Cada notificación se define por un **`NotificationType`** (fila en `notification_types`, identificada por
`code`), que **pertenece a una `NotificationCategory`**. Un caso de uso dispara
`notifier.notify({ type: 'CODE', ... })`; el sistema resuelve el tipo por `code`, renderiza los
templates con `metadata`, guarda la notificación in-app y **una entrega por cada canal externo** que
corresponda (push/email/**sms**), y las envía respetando la preferencia del usuario, su horario de silencio
y los reintentos.

> **La categoría es la FUENTE DE VERDAD** de: los canales soportados (`supports_push`/`supports_email`/
> `supports_sms`), la **criticidad** (`is_critical`: se envía siempre, sin mirar la preferencia ni el
> horario de silencio del usuario) y el **layout base del email** (`email_layout_template`, un cascarón
> HTML con el placeholder `{{content}}` donde se inyecta el `email_body_template` del tipo). El **tipo**
> solo aporta su contenido (los templates). La **preferencia del usuario** es una sola, global.

```
Caso de uso ──notify()──> resuelve NotificationType por code (+ su categoría)
                                  └─ render {{variables}} con metadata
                                  └─ en UNA transacción: Notification (in-app) + NotificationDelivery por canal
                                  └─ tras confirmar: envía las entregas en segundo plano (push SNS / email SES / sms SNS)
                                  └─ emite SSE 'count-updated'
Despachador (cron, cada minuto) ──> envía las entregas vencidas: diferidas, reintentos y las que quedaron a medias
```

## ¿Cuándo disparar una notificación? (criterio)

A diferencia de `audit.record` (mecánico: **todo** punto de entrada audita), una notificación se crea **solo cuando el evento le importa a una persona como hecho que querría conocer**. Reads, listados y consultas NO notifican; transiciones de estado, decisiones y acciones sobre la cuenta/expediente del usuario SÍ.

### El canal interno es el piso; correo/push se deciden por sensibilidad

Toda notificación crea el registro **interno (in-app)** — es el piso, siempre presente. Lo único que se decide caso por caso es si además sale por **correo** y/o **push**, según importancia/sensibilidad:

- Acción rutinaria → puede quedar solo interna. Ej: `PROFILE_UPDATED` ("actualizaste tu perfil con éxito").
- Acción sensible / de seguridad → interna **+ correo**. Ej: `TOTP_ACTIVADO`, `RESET_PASSWORD`.

(El canal efectivo se gatea con `supports_email`/`supports_push`/`supports_sms` de la **categoría** del tipo **+** la preferencia `allow_email`/`allow_push`/`allow_sms` del usuario, salvo categoría crítica — ver "Entregas por canal".)

### Rutas de cliente → destinatario = el propio cliente (self)

La acción la ejecuta el cliente y le interesa saber que la hizo: `userId = req.user.userId`. Ejemplos reales del template: perfil (`EMAIL_UPDATED`, `PHONE_UPDATED`, `PASSWORD_UPDATED`, `NATIONAL_ID_UPDATED`), seguridad (`NUEVO_DISPOSITIVO_DETECTADO`, `CODIGO_VERIFICACION`), onboarding (`BIENVENIDA`).

### Rutas de admin → interno del admin + (si afecta al cliente) notificación al cliente

Misma lógica, con un matiz: si la acción del admin es algo que **al cliente le interesa saber**, se crean DOS notificaciones en el mismo método (**doble notificación**):

1. al **cliente afectado** (`target-client`, userId resuelto vía `person_id`) — la decisión/hecho.
2. **interna al admin** que la ejecutó (`adminUserId`) — registro de su propia acción.

Ejemplo canónico real — `admin-person.service.ts`, al activar/desactivar la cuenta de un cliente:

```js
setImmediate(() => {
  // 1) al cliente afectado: se entera de la decisión sobre su cuenta
  notifier.notify({
    type: userNotificationType, // ACCOUNT_ACTIVATED | ACCOUNT_DEACTIVATED
    userId: affectedUserId
    /* ... */
  }).catch(/* ... */);

  // 2) interna para el admin que actuó: queda registrado que él lo hizo
  notifier.notify({
    type: 'PERSON_ADMIN_ACTION',
    userId: adminUserId
    /* ... */
  }).catch(/* ... */);
});
```

Otros `target-client` reales (admin actúa → el cliente se entera): `ACCOUNT_BLOCKED`, `NATIONAL_ID_CHANGED`, `EMAIL_CHANGED_NEW`/`_OLD`, `PASSWORD_RESET_ADMIN`, `AUTH_SESSION_REVOKED_CLIENT`. En IAM (gestión de usuarios internos): `IAM_ADMIN_ROLE_CHANGED`, `IAM_ADMIN_STATUS_CHANGED`, `IAM_ADMIN_USER_CREATED`.

### Destinatarios que no son "un usuario" → `notifyEmail`

Cuando el destinatario no tiene cuenta (o no debe pasar por la preferencia ni el horario de silencio) se usa `notifyEmail({ type, email, metadata })` — email puro, sin persistir `Notification`. Casos reales del template: confirmación de cuenta eliminada (`CUENTA_ELIMINADA`) y solicitudes de reset de credenciales por email (`CODIGO_VERIFICACION`).

### Disparadas por workers/system (sin actor humano)

Eventos de tiempo/lote emitidos por un worker con `userId:'system'`: el destinatario es quien deba enterarse (el cliente afectado, el admin, o un email directo). El template base trae poca notificación de este tipo; es el gancho para cuando un dominio derivado agregue vencimientos, SLA, recordatorios, etc.

### Resumen del criterio

> Notifica cuando el evento le importe a alguien como hecho personal/operativo. **Interno siempre; correo/push por sensibilidad.** Cliente → al propio cliente. Admin → interno del admin, **y además** al cliente si la acción le concierne (doble notificación). Sin cuenta → `notifyEmail`. Reads/listados → **no** notifican.

## Arquitectura de archivos

En Clean Architecture (docs/CLEAN-ARCHITECTURE.md):

```
src/modules/notification/
  domain/          tipos y categorías (plantillas {{var}}, canales), preferencia y horario de silencio,
                   entregas (plan, reintentos), email (layout), OTP, supresión, feed de rebotes, envío masivo
  application/
    use-cases/     create-notification ← ENTRADA (CreateNotification, SendDirectEmail)
                   deliveries (programar, intentar, despachador) / broadcast (globales) / send-templated-email
                   inbox (bandeja y contador) / preferences / verification-codes / bounce-feed / cleanup
                   notification-catalog y admin-notifications (panel: categorías, tipos, avisos, entregas)
    ports/         repositorios, proveedores de cada canal, destinatarios (iam) y prefijos (catalogs)
  infrastructure/  persistence (Prisma) / providers (SES, SNS push y SMS, rate limit) / realtime (SSE) /
                   workers (despachador + limpiezas) / legacy (lo que iam usa por el index.ts)
  presentation/http/  rutas, controllers, requests/responses Zod y docs OpenAPI
  notification.module.ts  composición
```

Preferencia por usuario: tabla `user_notification_preferences`, **una fila por usuario** (`user_id` UNIQUE).

## API — el puerto `Notifier`

### `notify({ type, userId, relatedEntity, metadata })`

```ts
// En un caso de uso, el Notifier llega por constructor (src/main/container.ts lo conecta); en un módulo sin
// migrar: const { notifier } = notificationModule;

setImmediate(() => {
  notifier.notify({
    type: 'IAM_ADMIN_ROLE_CHANGED', // code del NotificationType (requerido)
    userId: user.user_id, // null => notificación GLOBAL a todos los activos
    relatedEntity: { type: 'User', id: user.user_id }, // ⚠️ OBJETO { type, id } — no un string
    metadata: { nombre: 'Ana', nuevoRol: 'AUDITOR', logoUrl } // el logo de las plantillas también llega por configuración
  }).catch(err => logger.error('Error notificando', { error: err.message }));
});
```

- **`type`** (req): `code` del tipo.
- **`userId`** (opcional): si `null` → **notificación global** (una fila en `global_notifications` que todos ven in-app + envío masivo por push/email a todos los clientes activos; ver "Notificaciones globales"). Cuidado: es masivo.
- **`relatedEntity`** (opcional): `{ type, id }`. Se persiste en `related_entity_type` / `related_entity_id`. (Algunos casos legacy pasan un string; la forma correcta es el objeto.)
- **`metadata`** (opcional): valores que reemplazan los `{{placeholders}}` de los templates. Pasar **todas** las variables que usan los templates o saldrán literales.

Internamente: valida el code, busca el `NotificationType`, renderiza `title/body` (+ email subject/body) con las plantillas del tipo (`domain/notification-type.ts`), guarda la notificación y sus entregas en una transacción y las envía tras confirmar (ver "Entregas por canal"). Si se llama dentro de un `unitOfWork.run()`, la notificación se crea en esa transacción y las entregas las envía el despachador después del commit. Retorna `{ estadoSolicitud, message }` + **una sola** de las dos ids, según el caso:
`notificationId` (individual) o `globalNotificationId` (global) — son mutuamente excluyentes.

### `notifyEmail({ type, email, metadata })`

Email directo a un destinatario **sin userId** (no persiste en BD, no respeta el horario de silencio ni se reintenta). Para: acuse de PQRS/contacto a alguien sin cuenta, confirmación de cuenta eliminada, avisos a un email administrativo/externo.

### Emails con adjuntos (PDF, etc.)

Los adjuntos son **ortogonales al diseño**: el layout de la categoría es el mismo lleve o no adjunto. Como
el adjunto suele ser específico del usuario y del momento (un comprobante, un estado de cuenta), **viaja en
`metadata.attachments`** y el envío del email (`SendTemplatedEmail`) lo detecta automáticamente — no hay que marcar nada en el tipo:

```js
// El adjunto va en la metadata de la notificación. content = Buffer o string ya en base64.
setImmediate(() => {
  notifier.notify({
    type: 'COMPROBANTE_TRANSFERENCIA',
    userId: user.user_id,
    metadata: {
      nombre: 'Ana',
      attachments: [{ filename: 'comprobante.pdf', contentType: 'application/pdf', content: pdfBuffer }]
    }
  }).catch(err => logger.error('Error notificando', { error: err.message }));
});
```

- Si `metadata.attachments` trae adjuntos válidos, el proveedor (`infrastructure/providers/ses-email.gateway.ts`) usa
  `SendRawEmailCommand` (MIME multipart/mixed, cuerpo + adjuntos en base64, límite 10 MB de SES, respeta la
  suppression list). Si no hay adjuntos, `SendEmailCommand` (envío simple de siempre).
- Cada adjunto es `{ filename, contentType, content }` donde `content` es un `Buffer` o un string ya en base64
  (una metadata JSON no puede transportar un Buffer). Los inválidos (sin `filename` o sin contenido) se descartan.
- Extensión futura marcada en el código: soportar `url` en el adjunto (descargar el binario antes de adjuntar).

## Modelo `NotificationCategory` — campos (fuente de verdad)

| Campo                                               | Notas                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `code` STRING UNIQUE                                | Identificador de la categoría (ej: `SECURITY`, `ACCOUNT`, `TRANSACTIONAL`)                     |
| `name`, `description`                               | Legibles                                                                                       |
| `supports_push` / `supports_email` / `supports_sms` | **Canales habilitados** — mandan sobre el envío de todos los tipos de la categoría             |
| `is_critical`                                       | `true` → se envía siempre: ignora la preferencia y el horario de silencio del usuario          |
| `email_layout_template`                             | Cascarón HTML del email con `{{content}}` donde se inyecta el `email_body_template` del tipo   |
| `is_active`                                         | Habilitación                                                                                   |

## Modelo `NotificationType` — campos (contenido del evento)

| Campo                                            | Notas                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `code` STRING UNIQUE                             | Identificador usado en `notify()`                                           |
| `notification_category_id`                       | **Categoría a la que pertenece** — de ahí salen canales, criticidad y layout de email |
| `name`, `description`                            | Legibles                                                                               |
| `title_template` / `body_template`               | Push / in-app, con `{{variable}}`                                                      |
| `email_subject_template` / `email_body_template` | Email (HTML) — el `email_body_template` es el **fragmento** que se inyecta en el layout |
| `is_active`                                      | Habilita/deshabilita el tipo                                                           |

## Entregas por canal (`notification_deliveries`)

`notifications` es solo la bandeja in-app. Cada canal externo por el que sale una notificación es una fila
de `notification_deliveries`:

| Campo                          | Notas                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `channel`                      | `push` · `email` · `sms` (UNIQUE con `notification_id`)                                              |
| `status`                       | `pending` (por enviar o reintentando) · `sent` · `failed` (rebote definitivo o intentos agotados) · `skipped` (sin destinatario: sin dispositivos, sin email/teléfono, dirección suprimida) |
| `attempts`                     | Intentos hechos                                                                                     |
| `next_attempt_at`              | Cuándo toca el próximo intento (o fin de la reserva del intento en curso); `null` al terminar      |
| `sent_at`                      | Cuándo se envió                                                                                     |
| `last_error` / `last_error_code` | Último error y código del proveedor (p. ej. `MessageRejected`, `EndpointDisabled`)                |

### Qué canales y cuándo

1. **Canales:** los que soporta la categoría **y** permite la preferencia del usuario (`allow_push` /
   `allow_email` / `allow_sms`). Una categoría **crítica** ignora la preferencia: salen todos los que soporta.
2. **Cuándo:** si el usuario está en su horario de silencio (y la categoría no es crítica), las entregas se
   crean con `next_attempt_at` = fin del horario y las envía el despachador. Si no, se envían apenas se
   confirma la transacción.

### Envío, reintentos y recuperación

- **Una transacción.** La notificación y sus entregas se guardan juntas. Las que salen ya quedan
  **reservadas** (`next_attempt_at` = ahora + 5 min) y se envían en segundo plano tras el commit. Si el
  proceso muere antes de enviarlas, la reserva vence y el despachador las toma: no se pierden.
- **Dentro de un `unitOfWork.run()` de quien llama**, la notificación se crea en esa transacción y no se
  envía desde ahí (el commit llega después): las entregas quedan vencidas y las envía el próximo ciclo
  del despachador (≤ 1 min).
- **Despachador** (`notification-worker.ts`, cada minuto): toma de a 50 entregas `pending` con
  `next_attempt_at` vencido (`FOR UPDATE SKIP LOCKED`, y las reserva), así que **varias instancias no envían
  la misma**. En un ciclo sigue tomando hasta vaciar lo vencido o cumplir 45 s, y envía 10 notificaciones a
  la vez: una acumulación (fin del horario de silencio de muchos usuarios, un proveedor que vuelve) se vacía
  en minutos. Un ciclo sin trabajo no escribe nada en `operations`. La tabla funciona como cola. Cuándo
  conviene pasar a SQS, RabbitMQ o Kafka, y cómo hacerlo: docs/ARCHITECTURE.md, «Trabajo asíncrono».
- **Resultado de un intento:**
  - enviado → `sent`;
  - sin destinatario → `skipped` (no se reintenta);
  - error temporal → sigue `pending`, con espera creciente: **1 min → 5 min → 30 min → 2 h → 6 h**;
  - **rebote definitivo** (`isHardBounce`, catálogo en `src/shared/infrastructure/providers/aws-error-codes.ts`: email
    `MessageRejected`/`InvalidParameterValue`/`AccountSendingPausedException`, push
    `EndpointDisabled`/`InvalidParameter`) o **6.º intento fallido** → `failed`, y se audita **una vez**
    (`EMAIL_/PUSH_/SMS_DELIVERY_FAILED`, con `reason: hard_bounce | attempts_exhausted`).
  - Push: basta con que llegue a un dispositivo; es rebote definitivo solo si **todos** fallaron con un
    código definitivo. SMS no tiene código terminal: todo fallo se trata como temporal.
- **Al menos una vez.** Si el proceso muere entre que AWS acepta el envío y se marca `sent`, ese envío se
  repite al vencer la reserva (SES/SNS no aceptan una clave de idempotencia). Es raro y aceptable para
  notificaciones.
- **Sin reenvío manual.** Los reintentos automáticos cubren las caídas largas del proveedor (~8 h). Un OTP o
  un reset reenviado horas después ya no sirve (el usuario lo pide de nuevo), y la notificación in-app
  siempre queda.

### Consulta de entregas (admin)

`GET /api/v1/notification/notification-delivery?status&channel&userId&from&to` y
`GET .../notification-delivery/:id` (RBAC `notificationDeliveries` + READ): solo lectura, para responder
"¿le llegó el correo a este usuario?". Las métricas de éxito por proveedor están en CloudWatch
(`ProviderCalls`, ver docs/ARCHITECTURE.md).

**Dispositivos dados de baja.** Un `EndpointDisabled` de SNS significa que **ese dispositivo** ya no existe
para APNs/FCM (app desinstalada, token vencido): su token se desactiva en `user_push_tokens`
(`deactivateTokens`) y no se le vuelve a enviar, tanto en las entregas individuales como en el envío
masivo de las globales. No cambia el resultado de la entrega (si llegó a otro dispositivo, sigue `sent`).
Si el usuario vuelve a registrar el dispositivo, `upsertToken` lo reactiva y `registrarDispositivo` vuelve a
habilitar su endpoint en SNS (`CreatePlatformEndpoint` solo no lo hace: se lee con `GetEndpointAttributes` y,
si está deshabilitado o tiene otro token/usuario, se corrige con `SetEndpointAttributes`). Si el token ya
tenía endpoint de otro usuario (dispositivo compartido), se reutiliza ese endpoint. Los inactivos se borran a
los 90 días (limpieza diaria). `InvalidParameter` no desactiva: puede ser el mensaje y no el dispositivo.

## Notificaciones globales (`global_notifications`)

Una sola fila que todos ven en su bandeja (cada lectura va a `global_notification_reads`) y un **envío
masivo** por push/email a todos los clientes activos (`CLIENT_ROLE_NAMES`), según `send_push`/`send_email`
(los canales de la categoría al crearla).

- **Por páginas de 100 usuarios, ordenadas por `user_id`.** Cada página filtra con la preferencia de esos
  usuarios (una consulta; una categoría crítica la ignora), envía push en tandas de 100 tokens y email en
  tandas de 50 (con el rate limit de SNS/SES) y guarda el avance en la fila: `cursor_user_id` (último
  enviado), `push_sent_count`/`email_sent_count` y renueva la reserva `locked_until`.
- **`status`:** `pending` → `processing` → `completed`; `failed` si no se puede enviar (sin tipo).
- **Recuperación.** Al crearla queda reservada y se envía en segundo plano. Si el proceso muere, la reserva
  vence y el despachador la retoma **desde el cursor** (no vuelve a empezar ni queda colgada). Dentro de un
  `unitOfWork.run()` de quien llama queda `pending` y la envía el despachador tras el commit. Como las
  entregas individuales, es "al menos una vez": la página en curso al morir se reenvía.
- No hay vigencia ni segmentación: todas las globales se muestran a todos. Si llegaran a hacer falta, se
  agregan cuando haya un caso real.

## Workers — cron jobs (`notification-worker.ts`)

| Cron          | Frecuencia  | Qué hace                                                        |
| ------------- | ----------- | --------------------------------------------------------------- |
| `* * * * *`   | cada minuto | despachador: entregas vencidas + envíos masivos a retomar        |
| `0 3 * * *`   | 3 AM diario | limpia notificaciones leídas antiguas (sus entregas en cascada) |
| `0 4 * * *`   | 4 AM diario | limpia códigos de verificación (OTP) expirados                  |

## Comportamiento automático

- **Horario de silencio:** si el usuario configuró `quiet_hours_start`/`quiet_hours_end` (TIME, hora del
  servidor), el envío por canal externo se difiere hasta el fin de la ventana; la notificación in-app se crea
  igual. Soporta rangos que cruzan medianoche. **Una categoría crítica lo ignora.**
- **Preferencia:** una por usuario, `GET/PUT /person/notifications/preferences` (`allowPush` / `allowEmail` /
  `allowSms` + horario de silencio). Sin fila → todo permitido, sin horario. **Las categorías críticas la
  ignoran** (un usuario que apagó el email igual recibe el reset de contraseña).
- **Rate limiting:** tope por minuto de los envíos masivos, `SNS_RATE_LIMIT_PER_MINUTE` (300) y
  `SES_RATE_LIMIT_PER_MINUTE` (200): ajustarlos a la cuota real de la cuenta de AWS. Cada tanda suma su
  tamaño con un `INCRBY` atómico de Redis (compartido entre instancias); si se pasa, espera al minuto
  siguiente. Sin Redis cuenta en el proceso.
- **SSE (contador de no leídas):** `infrastructure/realtime/unread-count.emitter.ts` (puerto `UnreadCountChannel`) transporta `count-updated` (Redis Pub/Sub, fallback EventEmitter local; se inicializa en `src/main/server.ts`); el stream es `GET /notification/notifications/count/stream` (`presentation/http/notification.controllers.ts`). El punto único de refresco es `UnreadCounter.refresh(userId)` (`application/use-cases/unread-counter.ts`), invocado vía `setImmediate` en cada flujo que altera el contador: crear notificación individual (`CreateNotification`), marcar leídas al listar personal/global/mixto (`inbox.use-cases.ts`), además del aviso propio de `GetUnreadCount`. La **notificación global** (1 fila para todos) no hace fan-out por usuario: publica un broadcast `{ global: true }` y cada conexión SSE abierta recalcula su propio count (`UnreadCounter.compute`: dos `COUNT`, sin re-emitir ni auditar) tras una espera al azar de hasta 5 s, para que miles de conexiones no consulten la base en el mismo instante. **Auth por cookie** (`access_token`, canal web): el front abre el stream con `fetch` + `credentials:'include'` (no `EventSource` nativo, que no puede mandar la cookie cross-site). **Heartbeat:** el stream emite un comentario SSE `: ping` cada 25 s (`SSE_HEARTBEAT_MS`) para que el idle timeout del reverse proxy (ALB/nginx, ~60 s) no cierre la conexión en periodos sin eventos y congele el contador; se limpia en `req.on('close')` junto con el listener.

## Criticidad (`is_critical`)

Crítica = identidad, seguridad de acceso, OTP/recuperación de cuenta, cambios sensibles de cuenta
(categorías `SECURITY` y `EMERGENCY` del seed). Efecto: salen por todos los canales que soporta la
categoría aunque el usuario los haya apagado, y sin esperar su horario de silencio. NO crítica =
informativas. Se define a nivel categoría en el seeder.

## Seed de tipos y categorías

Los datos viven en `prisma/seeds/` y los siembra `npm run db:seed` (`prisma/seeds/notifications.seed.ts`;
regla general del seed en [`database.md`](database.md#seed)):

- **Tipos:** un archivo por módulo en `prisma/seeds/notification-types/<modulo>.ts` (`shared-kyc`, `client-kyc`,
  `admin-kyc`, `admin-iam`, `admin-audit`, `admin-approvals`), que devuelve un arreglo de
  `NotificationTypeSeed` (`code`, `name`, `description`, `titleTemplate`, `bodyTemplate`,
  `emailSubjectTemplate`, `emailBodyTemplate`). Se insertan los `code` que faltan.
- **Templates:** son del seed (la API no los edita). Si cambian en el archivo, `db:seed` los actualiza en la
  base; nombre, descripción, estado y categoría quedan como los dejó el admin.
- **Categorías:** `prisma/seeds/data/notification-categories.ts` (con el `emailLayoutTemplate` por
  categoría). Se insertan las que faltan; después se editan desde el admin.
- **Tipo → categoría:** `CATEGORY_BY_TYPE` en `notifications.seed.ts` (por `code`). Solo se asigna a los
  tipos sin categoría: después se cambia desde el admin con `PATCH /notification-types/:id { notificationCategoryId }`.

Tipo nuevo de un dominio: agregarlo al archivo de su módulo (o uno nuevo, sumado en `notifications.seed.ts`),
su código en `CATEGORY_BY_TYPE`, y `npm run db:seed`.

## Reglas

- ❌ Nunca instanciar `SESClient`/`SNSClient` directo — usar `EmailNotificationService` / `PushNotificationService`.
- ❌ Nunca `await notify()` en el flujo principal — siempre `setImmediate(() => ...).catch(...)`.
- ✅ Los tipos y sus templates se definen en el seed (`prisma/seeds/notification-types/`) — no hardcodear templates.
- ✅ Los tipos se consultan por `code`, nunca por id.
- ✅ `relatedEntity` es `{ type, id }`.
