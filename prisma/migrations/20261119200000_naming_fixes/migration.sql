-- Nombres que se habían salido de la convención (docs/prisma-migration.md#convenciones-de-nombres): los
-- tipos ENUM de las notificaciones, la única tabla con nombre de modelo en plural y las PK que no se
-- llamaban <tabla_en_singular>_id. Todo es metadatos (RENAME) salvo el estado de global_notifications,
-- que pasa a su propio tipo sin el valor partial_failure (ningún código lo escribe desde el envío
-- por páginas de 20261119160000_global_notifications_resumable).

-- ── 1. Enums: enum_<tabla>_<columna> ─────────────────────────────────────────────────────────────
ALTER TYPE "enum_notification_channel" RENAME TO "enum_notification_deliveries_channel";
ALTER TYPE "enum_notification_delivery_status" RENAME TO "enum_notification_deliveries_status";

CREATE TYPE "enum_global_notifications_status" AS ENUM ('pending', 'processing', 'completed', 'failed');
-- Defensivo: un envío viejo que hubiera quedado en partial_failure terminó con fallas
UPDATE "global_notifications" SET "status" = 'failed' WHERE "status" = 'partial_failure';
ALTER TABLE "global_notifications" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "global_notifications"
  ALTER COLUMN "status" TYPE "enum_global_notifications_status" USING ("status"::text::"enum_global_notifications_status");
ALTER TABLE "global_notifications" ALTER COLUMN "status" SET DEFAULT 'pending';
DROP TYPE "enum_notification_processing_status";

-- ── 2. reset_credentials → credential_resets (modelo CredentialReset) ───────────────────────────
ALTER TABLE "reset_credentials" RENAME TO "credential_resets";
ALTER TABLE "credential_resets" RENAME COLUMN "reset_credentials_id" TO "credential_reset_id";
ALTER TABLE "credential_resets" RENAME CONSTRAINT "pk_reset_credentials" TO "pk_credential_resets";
ALTER TABLE "credential_resets" RENAME CONSTRAINT "uq_reset_credentials_token" TO "uq_credential_resets_token";
ALTER TABLE "credential_resets" RENAME CONSTRAINT "fk_reset_credentials_user_id" TO "fk_credential_resets_user_id";
ALTER INDEX "idx_reset_credentials_email" RENAME TO "idx_credential_resets_email";
ALTER INDEX "idx_reset_credentials_expires_at" RENAME TO "idx_credential_resets_expires_at";
ALTER INDEX "idx_reset_credentials_origin_session_id" RENAME TO "idx_credential_resets_origin_session_id";
ALTER INDEX "idx_reset_credentials_token_validation" RENAME TO "idx_credential_resets_token_validation";
ALTER INDEX "idx_reset_credentials_type" RENAME TO "idx_credential_resets_type";
ALTER INDEX "idx_reset_credentials_used" RENAME TO "idx_credential_resets_used";
ALTER INDEX "idx_reset_credentials_user_id" RENAME TO "idx_credential_resets_user_id";
ALTER INDEX "idx_reset_credentials_user_type_used" RENAME TO "idx_credential_resets_user_type_used";
ALTER TYPE "enum_reset_credentials_type" RENAME TO "enum_credential_resets_type";

-- ── 3. PK: <tabla_en_singular>_id ────────────────────────────────────────────────────────────────
-- Ninguna FK apunta a estas columnas y los nombres de constraint (pk_<tabla>) no cambian.
ALTER TABLE "audit_alerts" RENAME COLUMN "alert_id" TO "audit_alert_id";
ALTER TABLE "biometric_challenges" RENAME COLUMN "challenge_id" TO "biometric_challenge_id";
ALTER TABLE "provider_fallback_events" RENAME COLUMN "fallback_event_id" TO "provider_fallback_event_id";
ALTER TABLE "sms_delivery_attempts" RENAME COLUMN "sms_attempt_id" TO "sms_delivery_attempt_id";
ALTER TABLE "system_global_config" RENAME COLUMN "config_id" TO "system_global_config_id";
ALTER TABLE "user_biometric_credentials" RENAME COLUMN "biometric_credential_id" TO "user_biometric_credential_id";
ALTER TABLE "role_permission_overrides" RENAME COLUMN "role_permission_id" TO "role_permission_override_id";
