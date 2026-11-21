-- integration_resilience: fuera manual_review_timeout_ms y screening_throttle (nada los leía).
ALTER TABLE "system_global_config"
  ALTER COLUMN "integration_resilience"
  SET DEFAULT '{"timeout_ms": 30000, "max_retries": 3, "circuit_breaker": {"failures_ttl_s": 300, "recovery_time_ms": 60000, "failure_threshold": 5}}';

UPDATE "system_global_config"
SET "integration_resilience" = "integration_resilience" - 'manual_review_timeout_ms' - 'screening_throttle'
WHERE "integration_resilience" ?| ARRAY['manual_review_timeout_ms', 'screening_throttle'];

COMMENT ON COLUMN "system_global_config"."integration_resilience" IS 'Resiliencia de las llamadas a proveedores externos, un solo valor para todos: { timeout_ms (por intento), max_retries (intentos, solo errores transitorios), circuit_breaker: { failure_threshold, recovery_time_ms, failures_ttl_s } }. La leen callProvider y el circuit breaker vía ResilienceConfig (caché 60s, defaults si falta).';
