-- audit_logs guarda hechos de negocio; los datos técnicos de la petición (método, ruta, status, error)
-- viven en `operations`. Antes de borrar esas columnas se copian a details, para no perder historial.
-- La tabla es append-only (trigger): la copia se hace con el trigger deshabilitado solo durante esta migración.
ALTER TABLE "audit_logs" DISABLE TRIGGER "trg_audit_logs_immutable";

UPDATE "audit_logs"
SET "details" = COALESCE("details", '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
  'httpStatus', "http_status",
  'errorCode', "error_code",
  'errorMessage', "error_message",
  'method', "method",
  'path', "path"
))
WHERE "http_status" IS NOT NULL OR "error_code" IS NOT NULL OR "error_message" IS NOT NULL
   OR "method" IS NOT NULL OR "path" IS NOT NULL;

ALTER TABLE "audit_logs" ENABLE TRIGGER "trg_audit_logs_immutable";

-- Índices redundantes (cubiertos por los compuestos que quedan) o de columnas sin filtro frecuente
DROP INDEX "idx_audit_logs_category";
DROP INDEX "idx_audit_logs_ip";
DROP INDEX "idx_audit_logs_risk";
DROP INDEX "idx_audit_logs_source";
DROP INDEX "idx_audit_logs_user_id";
DROP INDEX "idx_audit_logs_entity_table";
DROP INDEX "idx_audit_logs_module";
DROP INDEX "idx_audit_logs_outcome";
DROP INDEX "idx_audit_logs_session_id";

ALTER TABLE "audit_logs"
  DROP COLUMN "http_status",
  DROP COLUMN "error_code",
  DROP COLUMN "error_message",
  DROP COLUMN "method",
  DROP COLUMN "path";

-- Quedó huérfana al eliminar user_change_logs
DROP FUNCTION IF EXISTS trg_fn_user_change_logs_immutable();
