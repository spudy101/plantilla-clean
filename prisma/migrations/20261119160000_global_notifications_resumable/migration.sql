-- Notificaciones globales: un solo estado de envío y avance guardado en la fila (docs/notifications.md).
--   * el envío masivo va por páginas de usuarios (orden user_id) y guarda el último enviado en
--     cursor_user_id; locked_until es la reserva del envío en curso: si el proceso muere, vence y el
--     despachador lo retoma desde el cursor (antes quedaba en "processing" para siempre);
--   * fuera lo que no decidía nada: vigencia (is_active, starts_at, ends_at, send_in_app: nada los
--     cambiaba), segmentación nunca implementada (target_user_role, target_conditions), created_by
--     (nunca se escribía; el actor está en la auditoría GLOBAL_NOTIFICATION_SENT), batch_size (el código
--     usaba una constante), total_target_users y processing_started/completed_at (nadie los leía).

ALTER TABLE "global_notifications"
  ADD COLUMN "status" "enum_notification_processing_status" NOT NULL DEFAULT 'pending',
  ADD COLUMN "cursor_user_id" UUID,
  ADD COLUMN "locked_until" TIMESTAMPTZ(6);

-- Estado de las existentes: sin cursor no se pueden retomar, así que una que no terminó queda failed
-- (reanudarla desde cero reenviaría a quienes ya la recibieron).
UPDATE "global_notifications" SET "status" = CASE
  WHEN (NOT COALESCE("send_push", false) OR "push_processing_status" = 'completed')
   AND (NOT COALESCE("send_email", false) OR "email_processing_status" = 'completed') THEN 'completed'
  ELSE 'failed'
END::"enum_notification_processing_status";

UPDATE "global_notifications" SET
  "send_push" = COALESCE("send_push", false),
  "send_email" = COALESCE("send_email", false),
  "push_sent_count" = COALESCE("push_sent_count", 0),
  "email_sent_count" = COALESCE("email_sent_count", 0);

ALTER TABLE "global_notifications" DROP CONSTRAINT "fk_global_notifications_created_by";
DROP INDEX "idx_global_notifications_created_by";
DROP INDEX "idx_global_notifications_email_processing_status";
DROP INDEX "idx_global_notifications_is_active_starts_at_ends_at";
DROP INDEX "idx_global_notifications_push_processing_status";

ALTER TABLE "global_notifications" DROP COLUMN "batch_size",
DROP COLUMN "created_by",
DROP COLUMN "email_processing_status",
DROP COLUMN "ends_at",
DROP COLUMN "is_active",
DROP COLUMN "processing_completed_at",
DROP COLUMN "processing_started_at",
DROP COLUMN "push_processing_status",
DROP COLUMN "send_in_app",
DROP COLUMN "starts_at",
DROP COLUMN "target_conditions",
DROP COLUMN "target_user_role",
DROP COLUMN "total_target_users",
ALTER COLUMN "send_push" SET NOT NULL,
ALTER COLUMN "send_email" SET NOT NULL,
ALTER COLUMN "push_sent_count" SET NOT NULL,
ALTER COLUMN "email_sent_count" SET NOT NULL;

-- El despachador busca las pendientes o a medias por estado
CREATE INDEX "idx_global_notifications_status" ON "global_notifications"("status");

COMMENT ON TYPE "enum_notification_processing_status" IS 'Estado del envío masivo de una notificación global (partial_failure ya no se usa).';
