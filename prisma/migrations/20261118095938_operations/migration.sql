-- CreateEnum
CREATE TYPE "enum_operations_source" AS ENUM ('http', 'webhook', 'worker', 'system');

-- CreateEnum
CREATE TYPE "enum_operations_status" AS ENUM ('running', 'success', 'failure');

-- AlterTable
ALTER TABLE "integration_api_logs" ADD COLUMN     "correlation_id" VARCHAR(100);

-- CreateTable
CREATE TABLE "operations" (
    "operation_id" VARCHAR(100) NOT NULL,
    "parent_id" VARCHAR(100),
    "client_request_id" VARCHAR(128),
    "source" "enum_operations_source" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "ip" VARCHAR(45),
    "status" "enum_operations_status" NOT NULL DEFAULT 'running',
    "http_status" SMALLINT,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,

    CONSTRAINT "pk_operations" PRIMARY KEY ("operation_id")
);

-- CreateIndex
CREATE INDEX "idx_operations_started_at" ON "operations"("started_at");

-- CreateIndex
CREATE INDEX "idx_operations_status_started_at" ON "operations"("status", "started_at");

-- CreateIndex
CREATE INDEX "idx_operations_user_started_at" ON "operations"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_operations_source_started_at" ON "operations"("source", "started_at");

-- CreateIndex
CREATE INDEX "idx_operations_parent_id" ON "operations"("parent_id");

-- CreateIndex
CREATE INDEX "idx_integration_api_logs_correlation_id" ON "integration_api_logs"("correlation_id");
