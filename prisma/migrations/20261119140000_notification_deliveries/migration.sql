-- Notificaciones simplificadas (docs/notifications.md):
--   * el envío por canal pasa de ~20 columnas en notifications a la tabla notification_deliveries
--     (una fila por canal; la toma un solo despachador);
--   * preferencias solo globales (una fila por usuario; las categorías críticas las ignoran);
--   * fuera los campos que no decidían nada: prioridad, DND y horario por defecto de la categoría,
--     prioridad del tipo, processing_status / scheduled_for / retry_count / priority de notifications;
--   * sin reenvío manual: el permiso RBAC notificationResend pasa a notificationDeliveries (solo lectura).

-- ── Entregas por canal ────────────────────────────────────────
CREATE TYPE "enum_notification_channel" AS ENUM ('push', 'email', 'sms');
CREATE TYPE "enum_notification_delivery_status" AS ENUM ('pending', 'sent', 'failed', 'skipped');

CREATE TABLE "notification_deliveries" (
    "notification_delivery_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "enum_notification_channel" NOT NULL,
    "status" "enum_notification_delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_notification_deliveries" PRIMARY KEY ("notification_delivery_id")
);

-- El despachador busca por (status, next_attempt_at)
CREATE INDEX "idx_notification_deliveries_status_next_attempt_at" ON "notification_deliveries"("status", "next_attempt_at");
CREATE UNIQUE INDEX "uq_notification_deliveries_notification_id_channel" ON "notification_deliveries"("notification_id", "channel");
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "fk_notification_deliveries_notification_id" FOREIGN KEY ("notification_id") REFERENCES "notifications"("notification_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Traspaso del estado por canal. Solo los canales que se intentaron o quedaron programados:
--   enviado → sent · con fecha de próximo intento y sin agotar (3) → pending · el resto con error → failed.
INSERT INTO "notification_deliveries"
  ("notification_delivery_id", "notification_id", "channel", "status", "attempts", "next_attempt_at", "sent_at", "last_error", "last_error_code", "created_at", "updated_at")
SELECT gen_random_uuid(), n."notification_id", c."channel"::"enum_notification_channel",
  CASE
    WHEN c."sent" THEN 'sent'
    WHEN c."next_retry_at" IS NOT NULL AND COALESCE(c."retry_count", 0) < 3 THEN 'pending'
    ELSE 'failed'
  END::"enum_notification_delivery_status",
  COALESCE(c."retry_count", 0) + CASE WHEN c."sent" THEN 1 ELSE 0 END,
  CASE WHEN NOT c."sent" AND COALESCE(c."retry_count", 0) < 3 THEN c."next_retry_at" END,
  c."sent_at", c."error", c."error_code", n."created_at", CURRENT_TIMESTAMP
FROM "notifications" n
CROSS JOIN LATERAL (VALUES
  ('push',  COALESCE(n."push_sent", false),  n."push_sent_at",  n."push_error",  n."push_error_code",  n."push_retry_count",  n."push_next_retry_at"),
  ('email', COALESCE(n."email_sent", false), n."email_sent_at", n."email_error", n."email_error_code", n."email_retry_count", n."email_next_retry_at"),
  ('sms',   COALESCE(n."sms_sent", false),   n."sms_sent_at",   n."sms_error",   NULL::VARCHAR(100),   n."sms_retry_count",   n."sms_next_retry_at")
) AS c("channel", "sent", "sent_at", "error", "error_code", "retry_count", "next_retry_at")
WHERE c."sent" OR c."error" IS NOT NULL OR c."next_retry_at" IS NOT NULL;

DROP INDEX "idx_notifications_email_next_retry_at";
DROP INDEX "idx_notifications_push_next_retry_at";

ALTER TABLE "notifications" DROP COLUMN "email_error",
DROP COLUMN "email_error_code",
DROP COLUMN "email_next_retry_at",
DROP COLUMN "email_retry_count",
DROP COLUMN "email_sent",
DROP COLUMN "email_sent_at",
DROP COLUMN "priority",
DROP COLUMN "processing_status",
DROP COLUMN "push_error",
DROP COLUMN "push_error_code",
DROP COLUMN "push_next_retry_at",
DROP COLUMN "push_retry_count",
DROP COLUMN "push_sent",
DROP COLUMN "push_sent_at",
DROP COLUMN "retry_count",
DROP COLUMN "scheduled_for",
DROP COLUMN "sms_error",
DROP COLUMN "sms_next_retry_at",
DROP COLUMN "sms_retry_count",
DROP COLUMN "sms_sent",
DROP COLUMN "sms_sent_at";

-- ── Preferencias: una sola (global) por usuario ───────────────
-- Fuera los ajustes por categoría y, si un usuario quedó con más de una global, se conserva la más reciente.
DELETE FROM "user_notification_preferences" WHERE "notification_category_code" IS NOT NULL;
DELETE FROM "user_notification_preferences" p
USING "user_notification_preferences" newer
WHERE p."user_id" = newer."user_id"
  AND (p."updated_at", p."user_notification_preference_id") < (newer."updated_at", newer."user_notification_preference_id");

ALTER TABLE "user_notification_preferences" DROP CONSTRAINT "fk_user_notification_preferences_notification_category_code";
DROP INDEX "idx_user_notification_preferences_notification_category_code";
DROP INDEX "uq_user_notif_prefs_user_id_notification_category_code";
DROP INDEX "idx_user_notification_preferences_user_id";
ALTER TABLE "user_notification_preferences" DROP COLUMN "notification_category_code";
CREATE UNIQUE INDEX "uq_user_notification_preferences_user_id" ON "user_notification_preferences"("user_id");

-- ── Categorías y tipos: solo lo que decide algo ───────────────
ALTER TABLE "notification_categories" DROP COLUMN "allow_dnd",
DROP COLUMN "default_quiet_hours_end",
DROP COLUMN "default_quiet_hours_start",
DROP COLUMN "priority",
DROP COLUMN "sort_order";

DROP INDEX "idx_notification_types_priority";
ALTER TABLE "notification_types" DROP COLUMN "priority";

-- ── Notificaciones globales: el enum de estado queda solo para ellas ──
COMMENT ON TYPE "enum_notification_processing_status" IS 'Estado de procesamiento de las notificaciones globales.';

-- ── RBAC: sin reenvío manual, el módulo queda de consulta ─────
DELETE FROM "role_permission_overrides" WHERE "module_name" = 'notificationResend' AND "action" <> 'read';
UPDATE "role_permission_overrides" SET "module_name" = 'notificationDeliveries' WHERE "module_name" = 'notificationResend';
