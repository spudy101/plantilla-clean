-- La bitácora de cambios pasa a vivir en audit_logs (acción USER_FIELD_CHANGED, valores en details).
-- Antes de borrar la tabla se copian sus filas, para no perder historial.
INSERT INTO "audit_logs" (
  "audit_log_id", "action", "description", "category", "risk", "outcome", "user_id", "correlation_id",
  "ip", "user_agent", "details", "source", "entity_id", "entity_type", "entity_table", "session_id",
  "created_at", "updated_at"
)
SELECT
  "log_id", 'USER_FIELD_CHANGED', 'Dato de una cuenta modificado', 'Personas', 'medium', 'success',
  "changed_by_user_id", "origin_correlation_id", "ip_address", "user_agent",
  jsonb_build_object(
    'changeType', "change_type"::text,
    'changedByRole', "changed_by_role"::text,
    'previousValue', "previous_value",
    'newValue', "new_value",
    'changeReason', "change_reason"
  ),
  'http', "user_id"::text, 'User', 'users', "origin_session_id", "created_at", "created_at"
FROM "user_change_logs";

-- DropForeignKey
ALTER TABLE "user_change_logs" DROP CONSTRAINT "fk_user_change_logs_changed_by_user_id";

-- DropForeignKey
ALTER TABLE "user_change_logs" DROP CONSTRAINT "fk_user_change_logs_user_id";

-- DropTable
DROP TABLE "user_change_logs";

-- DropEnum
DROP TYPE "enum_user_change_logs_change_type";

-- DropEnum
DROP TYPE "enum_user_change_logs_changed_by_role";
