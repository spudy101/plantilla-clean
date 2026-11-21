-- integration_api_logs se va: las métricas y la traza de cada llamada a un proveedor van a CloudWatch
-- (una línea de log por llamada, con métricas EMF). Lo único que el negocio leía de la tabla, el código
-- de error del último envío (para detectar rebotes definitivos), pasa a la propia notificación.

ALTER TABLE "notifications" ADD COLUMN "email_error_code" VARCHAR(100);
ALTER TABLE "notifications" ADD COLUMN "push_error_code" VARCHAR(100);

-- Se copia el código del último intento fallido de cada notificación con el canal todavía en error,
-- para que los reintentos pendientes sigan detectando sus rebotes después del cambio.
UPDATE "notifications" AS n
SET "email_error_code" = l."error_code"
FROM (
  SELECT DISTINCT ON ("notification_id") "notification_id", "error_code"
  FROM "integration_api_logs"
  WHERE "product" = 'ses' AND "notification_id" IS NOT NULL
  ORDER BY "notification_id", "created_at" DESC
) AS l
WHERE n."notification_id" = l."notification_id" AND n."email_error" IS NOT NULL AND l."error_code" IS NOT NULL;

UPDATE "notifications" AS n
SET "push_error_code" = l."error_code"
FROM (
  SELECT DISTINCT ON ("notification_id") "notification_id", "error_code"
  FROM "integration_api_logs"
  WHERE "product" = 'sns' AND "notification_id" IS NOT NULL
  ORDER BY "notification_id", "created_at" DESC
) AS l
WHERE n."notification_id" = l."notification_id" AND n."push_error" IS NOT NULL AND l."error_code" IS NOT NULL;

DROP TABLE "integration_api_logs";
DROP TYPE "enum_integration_api_logs_product";
DROP TYPE "enum_integration_api_logs_result";

-- Los módulos RBAC del dashboard de llamadas y la bitácora ya no existen (queda `providers`).
DELETE FROM "role_permission_overrides" WHERE "module_name" IN ('integrationDashboard', 'apiLogs');
