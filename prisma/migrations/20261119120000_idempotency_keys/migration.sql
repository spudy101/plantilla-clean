-- Claves de idempotencia (docs/idempotency.md): la primera petición con una clave se ejecuta y guarda su
-- respuesta; los reintentos con la misma clave reciben esa respuesta sin ejecutar de nuevo.
CREATE TYPE "enum_idempotency_keys_status" AS ENUM ('in_progress', 'completed');

CREATE TABLE "idempotency_keys" (
    "scope" VARCHAR(100) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "enum_idempotency_keys_status" NOT NULL DEFAULT 'in_progress',
    "response_status" SMALLINT,
    "response_body" JSONB,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_idempotency_keys" PRIMARY KEY ("scope", "idempotency_key")
);

-- La purga diaria borra por vencimiento
CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys"("expires_at");
