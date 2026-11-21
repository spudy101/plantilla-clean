-- 0_init — migración base de Prisma (fase 6 de docs/prisma-migration.md).
--
-- Reproduce la base que dejaban las 45 migraciones de Sequelize (hasta 20260731000004), generada con
-- `prisma migrate diff --from-empty --to-config-datasource` sobre un esquema recién migrado con ellas.
-- Sin calificar con el esquema: corre en el que elige la URL (`?schema=` ← DB_SCHEMA).
-- Las bases que ya tenían esas migraciones NO la ejecutan: `npm run db:migrate` la marca como aplicada
-- (scripts/db-migrate.ts). Los nombres heredados de Sequelize (índices, constraints, columnas `deletedAt`
-- residuales) se corrigen en la fase 6c, en una migración propia.

-- CreateEnum
CREATE TYPE "enum_approval_requests_status" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "enum_audit_alerts_risk" AS ENUM ('low', 'medium', 'high', 'critical', 'unknown');

-- CreateEnum
CREATE TYPE "enum_audit_logs_outcome" AS ENUM ('success', 'failure', 'warning', 'attempt');

-- CreateEnum
CREATE TYPE "enum_audit_logs_risk" AS ENUM ('low', 'medium', 'high', 'critical', 'unknown');

-- CreateEnum
CREATE TYPE "enum_email_bounce_suppressions_status" AS ENUM ('active', 'suppressed');

-- CreateEnum
CREATE TYPE "enum_integration_api_logs_product" AS ENUM ('ses', 's3', 'sns', 'aws_sms');

-- CreateEnum
CREATE TYPE "enum_integration_api_logs_result" AS ENUM ('success', 'failed', 'circuit_open');

-- CreateEnum
CREATE TYPE "enum_person_references_reference_type" AS ENUM ('conocido', 'familiar');

-- CreateEnum
CREATE TYPE "enum_reset_credentials_type" AS ENUM ('mfa', 'password');

-- CreateEnum
CREATE TYPE "enum_sms_delivery_attempts_status" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "enum_user_change_logs_change_type" AS ENUM ('email', 'password', 'mfa_status', 'account_status', 'role', 'national_id', 'name', 'gender', 'location', 'phone', 'birth_date', 'funds_origin', 'sms_mfa_status', 'preferred_mfa_method');

-- CreateEnum
CREATE TYPE "enum_user_change_logs_changed_by_role" AS ENUM ('admin', 'user', 'system');

-- CreateEnum
CREATE TYPE "enum_user_sessions_status" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "enum_verification_codes_type" AS ENUM ('email', 'phone', 'contract_signature');

-- CreateTable
CREATE TABLE "approval_requests" (
    "approval_request_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operation_key" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "enum_approval_requests_status" NOT NULL DEFAULT 'pending',
    "second_approver_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_notes" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "result" JSONB,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("approval_request_id")
);

-- CreateTable
CREATE TABLE "audit_alerts" (
    "alert_id" UUID NOT NULL,
    "audit_log_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50),
    "risk" "enum_audit_alerts_risk" NOT NULL DEFAULT 'high',
    "user_id" UUID,
    "entity_id" VARCHAR(255),
    "entity_type" VARCHAR(100),
    "message" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_alerts_pkey" PRIMARY KEY ("alert_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "audit_log_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "category" VARCHAR(50),
    "risk" "enum_audit_logs_risk" NOT NULL DEFAULT 'unknown',
    "outcome" "enum_audit_logs_outcome" NOT NULL DEFAULT 'success',
    "http_status" SMALLINT,
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "user_id" UUID,
    "correlation_id" VARCHAR(100),
    "ip" VARCHAR(45),
    "user_agent" TEXT,
    "fingerprint" VARCHAR(64),
    "method" VARCHAR(10),
    "path" TEXT,
    "details" JSONB,
    "source" VARCHAR(50) NOT NULL DEFAULT 'http',
    "entity_id" VARCHAR(255),
    "entity_type" VARCHAR(100),
    "entity_table" VARCHAR(150),
    "module" VARCHAR(50),
    "session_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_log_id")
);

-- CreateTable
CREATE TABLE "avatar_themes" (
    "avatar_theme_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "avatar_themes_pkey" PRIMARY KEY ("avatar_theme_id")
);

-- CreateTable
CREATE TABLE "avatars" (
    "avatar_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "avatar_theme_id" UUID NOT NULL,
    "image_url" VARCHAR(255),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("avatar_id")
);

-- CreateTable
CREATE TABLE "biometric_challenges" (
    "challenge_id" UUID NOT NULL,
    "user_id" UUID,
    "challenge" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "biometric_challenges_pkey" PRIMARY KEY ("challenge_id")
);

-- CreateTable
CREATE TABLE "cities" (
    "city_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "dane_code" VARCHAR(3),
    "department_id" UUID NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("city_id")
);

-- CreateTable
CREATE TABLE "consent_types" (
    "consent_type_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "is_revocable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "scope" VARCHAR(20) NOT NULL DEFAULT 'ONBOARDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consent_types_pkey" PRIMARY KEY ("consent_type_id")
);

-- CreateTable
CREATE TABLE "countries" (
    "country_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "icon_url" VARCHAR(255),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("country_id")
);

-- CreateTable
CREATE TABLE "departments" (
    "department_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "dane_code" VARCHAR(2),
    "country_id" UUID NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("department_id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "document_type_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_visible_to_client" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("document_type_id")
);

-- CreateTable
CREATE TABLE "email_bounce_suppressions" (
    "email_bounce_suppression_id" UUID NOT NULL,
    "email_hash" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "bounce_count" INTEGER NOT NULL DEFAULT 0,
    "status" "enum_email_bounce_suppressions_status" NOT NULL DEFAULT 'active',
    "last_error_code" VARCHAR(100),
    "last_bounce_at" TIMESTAMPTZ(6),
    "suppressed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_bounce_suppressions_pkey" PRIMARY KEY ("email_bounce_suppression_id")
);

-- CreateTable
CREATE TABLE "genders" (
    "gender_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "genders_pkey" PRIMARY KEY ("gender_id")
);

-- CreateTable
CREATE TABLE "global_notification_reads" (
    "global_notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),

    CONSTRAINT "global_notification_reads_pkey" PRIMARY KEY ("global_notification_id","user_id")
);

-- CreateTable
CREATE TABLE "global_notifications" (
    "global_notification_id" UUID NOT NULL,
    "notification_type_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "send_push" BOOLEAN DEFAULT false,
    "send_email" BOOLEAN DEFAULT false,
    "send_in_app" BOOLEAN DEFAULT true,
    "push_processing_status" VARCHAR(20) DEFAULT 'pending',
    "email_processing_status" VARCHAR(20) DEFAULT 'pending',
    "push_sent_count" INTEGER DEFAULT 0,
    "email_sent_count" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "target_user_role" VARCHAR(50),
    "target_conditions" JSONB,
    "created_by" UUID,
    "batch_size" INTEGER DEFAULT 100,
    "processing_started_at" TIMESTAMPTZ(6),
    "processing_completed_at" TIMESTAMPTZ(6),
    "total_target_users" INTEGER DEFAULT 0,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "global_notifications_pkey" PRIMARY KEY ("global_notification_id")
);

-- CreateTable
CREATE TABLE "integration_api_logs" (
    "api_log_id" UUID NOT NULL,
    "product" "enum_integration_api_logs_product" NOT NULL,
    "endpoint" VARCHAR(500) NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "result" "enum_integration_api_logs_result" NOT NULL,
    "response_time_ms" INTEGER,
    "error_code" VARCHAR(50),
    "error_message" TEXT,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "is_system_error" BOOLEAN NOT NULL DEFAULT false,
    "notification_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_api_logs_pkey" PRIMARY KEY ("api_log_id")
);

-- CreateTable
CREATE TABLE "notification_categories" (
    "notification_category_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "supports_push" BOOLEAN NOT NULL DEFAULT true,
    "supports_email" BOOLEAN NOT NULL DEFAULT true,
    "supports_sms" BOOLEAN NOT NULL DEFAULT false,
    "allow_dnd" BOOLEAN NOT NULL DEFAULT true,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "default_quiet_hours_start" TIME(6),
    "default_quiet_hours_end" TIME(6),
    "priority" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "email_layout_template" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_categories_pkey" PRIMARY KEY ("notification_category_id")
);

-- CreateTable
CREATE TABLE "notification_types" (
    "notification_type_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(20) DEFAULT 'normal',
    "title_template" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "email_subject_template" TEXT,
    "email_body_template" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "notification_category_id" UUID,

    CONSTRAINT "notification_types_pkey" PRIMARY KEY ("notification_type_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notification_type_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "related_entity_type" VARCHAR(50),
    "related_entity_id" UUID,
    "metadata" JSONB,
    "is_read" BOOLEAN DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "push_sent" BOOLEAN DEFAULT false,
    "push_sent_at" TIMESTAMPTZ(6),
    "push_error" TEXT,
    "push_retry_count" INTEGER DEFAULT 0,
    "push_next_retry_at" TIMESTAMPTZ(6),
    "email_sent" BOOLEAN DEFAULT false,
    "email_sent_at" TIMESTAMPTZ(6),
    "email_error" TEXT,
    "email_retry_count" INTEGER DEFAULT 0,
    "email_next_retry_at" TIMESTAMPTZ(6),
    "scheduled_for" TIMESTAMPTZ(6),
    "priority" INTEGER DEFAULT 5,
    "processing_status" VARCHAR(20) DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "sms_sent" BOOLEAN DEFAULT false,
    "sms_sent_at" TIMESTAMPTZ(6),
    "sms_error" TEXT,
    "sms_retry_count" INTEGER DEFAULT 0,
    "sms_next_retry_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "person_contacts" (
    "person_contact_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "email" VARCHAR(500) NOT NULL,
    "email_hash" VARCHAR(64),
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_primary" VARCHAR(150),
    "phone_primary_hash" VARCHAR(64),
    "phone_primary_prefix_id" UUID,
    "phone_primary_verified_at" TIMESTAMPTZ(6),
    "phone_secondary" VARCHAR(150),
    "phone_secondary_hash" VARCHAR(64),
    "phone_secondary_prefix_id" UUID,
    "phone_secondary_verified_at" TIMESTAMPTZ(6),
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "person_contacts_pkey" PRIMARY KEY ("person_contact_id")
);

-- CreateTable
CREATE TABLE "person_locations" (
    "person_location_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "country_id" UUID,
    "department_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "address" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(40),
    "type" VARCHAR(40),
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "person_locations_pkey" PRIMARY KEY ("person_location_id")
);

-- CreateTable
CREATE TABLE "person_references" (
    "person_reference_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "reference_name" VARCHAR(200) NOT NULL,
    "reference_phone" VARCHAR(20) NOT NULL,
    "reference_type" "enum_person_references_reference_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "person_references_pkey" PRIMARY KEY ("person_reference_id")
);

-- CreateTable
CREATE TABLE "persons" (
    "person_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "second_last_name" VARCHAR(100),
    "national_id" VARCHAR(150),
    "national_id_hash" VARCHAR(64),
    "document_type_id" UUID,
    "birth_date" DATE,
    "gender_id" UUID,
    "country_id" UUID,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "persons_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "phone_prefixes" (
    "phone_prefix_id" UUID NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "country_id" UUID NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "phone_prefixes_pkey" PRIMARY KEY ("phone_prefix_id")
);

-- CreateTable
CREATE TABLE "privacy_policies" (
    "privacy_policy_id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "document_url" VARCHAR(500) NOT NULL,
    "document_hash" VARCHAR(64),
    "summary" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "effective_date" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "privacy_policies_pkey" PRIMARY KEY ("privacy_policy_id")
);

-- CreateTable
CREATE TABLE "provider_fallback_events" (
    "fallback_event_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "circuit_product" VARCHAR(50) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "affected_processes_count" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_fallback_events_pkey" PRIMARY KEY ("fallback_event_id")
);

-- CreateTable
CREATE TABLE "reset_credentials" (
    "reset_credentials_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "type" "enum_reset_credentials_type" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used" BOOLEAN DEFAULT false,
    "used_at" TIMESTAMPTZ(6),
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "reset_credentials_pkey" PRIMARY KEY ("reset_credentials_id")
);

-- CreateTable
CREATE TABLE "role_permission_overrides" (
    "role_permission_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_name" VARCHAR(50) NOT NULL,
    "module_name" VARCHAR(50) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "granted_by_user_id" UUID NOT NULL,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_overrides_pkey" PRIMARY KEY ("role_permission_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "sms_delivery_attempts" (
    "sms_attempt_id" UUID NOT NULL,
    "user_id" UUID,
    "phone_hash" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(30) NOT NULL DEFAULT 'aws_sms',
    "purpose" VARCHAR(30) NOT NULL,
    "status" "enum_sms_delivery_attempts_status" NOT NULL DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_message_id" VARCHAR(255),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sms_delivery_attempts_pkey" PRIMARY KEY ("sms_attempt_id")
);

-- CreateTable
CREATE TABLE "system_global_config" (
    "config_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'CLP',
    "audit_retention_hot_years" INTEGER NOT NULL DEFAULT 5,
    "audit_retention_cold_years" INTEGER NOT NULL DEFAULT 10,
    "audit_hot_purge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "integration_resilience" JSONB NOT NULL DEFAULT '{"timeout_ms": 30000, "max_retries": 3, "circuit_breaker": {"failures_ttl_s": 300, "recovery_time_ms": 60000, "failure_threshold": 5}, "manual_review_timeout_ms": 10000}',
    "promotional_banners" JSONB NOT NULL DEFAULT '[]',
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_global_config_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "user_biometric_credentials" (
    "biometric_credential_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_trusted_device_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "sign_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_biometric_credentials_pkey" PRIMARY KEY ("biometric_credential_id")
);

-- CreateTable
CREATE TABLE "user_change_logs" (
    "log_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "changed_by_user_id" UUID,
    "changed_by_role" "enum_user_change_logs_changed_by_role" NOT NULL,
    "change_type" "enum_user_change_logs_change_type" NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "change_reason" VARCHAR(255),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_change_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "user_consent_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_type_id" UUID NOT NULL,
    "privacy_policy_id" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL,
    "granted_ip" VARCHAR(45),
    "granted_user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_ip" VARCHAR(45),
    "revocation_reason" VARCHAR(500),
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("user_consent_id")
);

-- CreateTable
CREATE TABLE "user_login_attempts" (
    "user_login_attempt_id" UUID NOT NULL,
    "user_id" UUID,
    "username_attempt" VARCHAR(255) NOT NULL,
    "national_id" VARCHAR(255) NOT NULL,
    "national_id_hash" VARCHAR(64),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "device_fingerprint" VARCHAR(255),
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" VARCHAR(255),
    "blocked_until" TIMESTAMPTZ(6),
    "attempted_at" TIMESTAMPTZ(6) NOT NULL,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_login_attempts_pkey" PRIMARY KEY ("user_login_attempt_id")
);

-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "user_notification_preference_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notification_category_code" VARCHAR(100),
    "allow_push" BOOLEAN DEFAULT true,
    "allow_email" BOOLEAN DEFAULT true,
    "quiet_hours_start" TIME(6),
    "quiet_hours_end" TIME(6),
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "allow_sms" BOOLEAN DEFAULT true,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("user_notification_preference_id")
);

-- CreateTable
CREATE TABLE "user_push_tokens" (
    "user_push_token_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "device_id" VARCHAR(255),
    "is_active" BOOLEAN DEFAULT true,
    "last_used_at" TIMESTAMPTZ(6),
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("user_push_token_id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "user_session_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "jti" VARCHAR(36) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "status" "enum_user_sessions_status" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_access_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "close_reason" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("user_session_id")
);

-- CreateTable
CREATE TABLE "user_trusted_devices" (
    "user_trusted_device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fingerprint_hash" VARCHAR(64) NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "ip_address" VARCHAR(45),
    "city" VARCHAR(100),
    "country" VARCHAR(100),
    "country_code" VARCHAR(5),
    "browser" VARCHAR(100),
    "os" VARCHAR(100),
    "device_type" VARCHAR(20) NOT NULL DEFAULT 'desktop',
    "hmac_secret" VARCHAR(200),
    "approved_by_device_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "blocked_by_device_id" UUID,
    "blocked_at" TIMESTAMPTZ(6),
    "trusted_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_trusted_devices_pkey" PRIMARY KEY ("user_trusted_device_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(255),
    "auth_username" VARCHAR(255),
    "person_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "avatar_id" UUID,
    "totp_enabled" BOOLEAN DEFAULT false,
    "sms_mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "preferred_mfa_method" VARCHAR(10) NOT NULL DEFAULT 'none',
    "privacy_policy_version" VARCHAR(20),
    "privacy_policy_accepted_at" TIMESTAMPTZ(6),
    "privacy_policy_accepted_ip" VARCHAR(45),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "totp_secret" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "verification_code_id" UUID NOT NULL,
    "type" "enum_verification_codes_type" NOT NULL,
    "contact_value" VARCHAR(255) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "attempts" INTEGER DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "origin_session_id" UUID,
    "origin_correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("verification_code_id")
);

-- CreateIndex
CREATE INDEX "idx_approval_requests_entity" ON "approval_requests"("entity_type" ASC, "entity_id" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_requests_expires_at" ON "approval_requests"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_requests_operation_key" ON "approval_requests"("operation_key" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_requests_origin_session_id" ON "approval_requests"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_requests_requested_by" ON "approval_requests"("requested_by" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_requests_status" ON "approval_requests"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_approval_requests_pending_entity_op" ON "approval_requests"("entity_type" ASC, "entity_id" ASC, "operation_key" ASC) WHERE (status = 'pending'::enum_approval_requests_status);

-- CreateIndex
CREATE INDEX "audit_alerts_action" ON "audit_alerts"("action" ASC);

-- CreateIndex
CREATE INDEX "audit_alerts_created_at" ON "audit_alerts"("created_at" ASC);

-- CreateIndex
CREATE INDEX "audit_alerts_user_id" ON "audit_alerts"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_alerts_pending" ON "audit_alerts"("acknowledged" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_action" ON "audit_logs"("action" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_category" ON "audit_logs"("category" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_correlation_id" ON "audit_logs"("correlation_id" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at" ON "audit_logs"("created_at" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_ip" ON "audit_logs"("ip" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_risk" ON "audit_logs"("risk" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_source" ON "audit_logs"("source" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id" ON "audit_logs"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_category_risk_date" ON "audit_logs"("category" ASC, "risk" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_entity_id" ON "audit_logs"("entity_id" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_entity_table" ON "audit_logs"("entity_table" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_module" ON "audit_logs"("module" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_outcome" ON "audit_logs"("outcome" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_outcome_date" ON "audit_logs"("outcome" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_session_date" ON "audit_logs"("session_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_session_id" ON "audit_logs"("session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_user_date" ON "audit_logs"("user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "avatar_themes_is_active" ON "avatar_themes"("is_active" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "avatar_themes" ADD CONSTRAINT "avatar_themes_name_key" UNIQUE ("name");

-- CreateIndex
CREATE INDEX "avatars_avatar_theme_id" ON "avatars"("avatar_theme_id" ASC);

-- CreateIndex
CREATE INDEX "avatars_is_active" ON "avatars"("is_active" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "biometric_challenges" ADD CONSTRAINT "biometric_challenges_challenge_key" UNIQUE ("challenge");

-- CreateIndex
CREATE INDEX "idx_biometric_challenges_expires_at" ON "biometric_challenges"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_biometric_challenges_user_id" ON "biometric_challenges"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_biometric_challenges_challenge" ON "biometric_challenges"("challenge" ASC);

-- CreateIndex
CREATE INDEX "cities_department_id" ON "cities"("department_id" ASC);

-- CreateIndex
CREATE INDEX "cities_department_id_name" ON "cities"("department_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "cities_is_active" ON "cities"("is_active" ASC);

-- CreateIndex
CREATE INDEX "cities_name" ON "cities"("name" ASC);

-- CreateIndex
CREATE INDEX "consent_types_code_idx" ON "consent_types"("code" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "consent_types" ADD CONSTRAINT "consent_types_code_key" UNIQUE ("code");

-- CreateIndex
CREATE INDEX "consent_types_is_active_idx" ON "consent_types"("is_active" ASC);

-- CreateIndex
CREATE INDEX "countries_code" ON "countries"("code" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "countries" ADD CONSTRAINT "countries_code_key" UNIQUE ("code");

-- CreateIndex
CREATE INDEX "countries_is_active" ON "countries"("is_active" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "countries" ADD CONSTRAINT "countries_name_key" UNIQUE ("name");

-- CreateIndex
CREATE INDEX "departments_country_id" ON "departments"("country_id" ASC);

-- CreateIndex
CREATE INDEX "departments_country_id_name" ON "departments"("country_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "departments_is_active" ON "departments"("is_active" ASC);

-- CreateIndex
CREATE INDEX "departments_name" ON "departments"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_types_code" ON "document_types"("code" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_code_key" UNIQUE ("code");

-- CreateIndex
CREATE INDEX "document_types_is_active" ON "document_types"("is_active" ASC);

-- CreateIndex
CREATE INDEX "document_types_is_visible_to_client" ON "document_types"("is_visible_to_client" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "email_bounce_suppressions" ADD CONSTRAINT "email_bounce_suppressions_email_hash_key" UNIQUE ("email_hash");

-- CreateIndex
CREATE INDEX "email_bounce_suppressions_last_bounce_at" ON "email_bounce_suppressions"("last_bounce_at" ASC);

-- CreateIndex
CREATE INDEX "email_bounce_suppressions_status" ON "email_bounce_suppressions"("status" ASC);

-- CreateIndex
CREATE INDEX "genders_is_active" ON "genders"("is_active" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "genders" ADD CONSTRAINT "genders_name_key" UNIQUE ("name");

-- CreateIndex
CREATE INDEX "global_notification_reads_global_notification_id" ON "global_notification_reads"("global_notification_id" ASC);

-- CreateIndex
CREATE INDEX "global_notification_reads_read_at" ON "global_notification_reads"("read_at" ASC);

-- CreateIndex
CREATE INDEX "global_notification_reads_user_id" ON "global_notification_reads"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_global_notification_reads_origin_session_id" ON "global_notification_reads"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "global_notifications_created_by" ON "global_notifications"("created_by" ASC);

-- CreateIndex
CREATE INDEX "global_notifications_email_processing_status" ON "global_notifications"("email_processing_status" ASC);

-- CreateIndex
CREATE INDEX "global_notifications_is_active_starts_at_ends_at" ON "global_notifications"("is_active" ASC, "starts_at" ASC, "ends_at" ASC);

-- CreateIndex
CREATE INDEX "global_notifications_notification_type_id" ON "global_notifications"("notification_type_id" ASC);

-- CreateIndex
CREATE INDEX "global_notifications_push_processing_status" ON "global_notifications"("push_processing_status" ASC);

-- CreateIndex
CREATE INDEX "idx_global_notifications_origin_session_id" ON "global_notifications"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "integration_api_logs_created_at" ON "integration_api_logs"("created_at" ASC);

-- CreateIndex
CREATE INDEX "integration_api_logs_notification_id" ON "integration_api_logs"("notification_id" ASC);

-- CreateIndex
CREATE INDEX "integration_api_logs_product" ON "integration_api_logs"("product" ASC);

-- CreateIndex
CREATE INDEX "integration_api_logs_product_result_created_at" ON "integration_api_logs"("product" ASC, "result" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "integration_api_logs_result" ON "integration_api_logs"("result" ASC);

-- CreateIndex
CREATE INDEX "integration_api_logs_session_id" ON "integration_api_logs"("session_id" ASC);

-- CreateIndex
CREATE INDEX "integration_api_logs_user_id" ON "integration_api_logs"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "idx_notification_categories_code" ON "notification_categories"("code" ASC);

-- CreateIndex
CREATE INDEX "idx_notification_categories_is_active" ON "notification_categories"("is_active" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "notification_categories" ADD CONSTRAINT "notification_categories_code_key" UNIQUE ("code");

-- CreateIndex
CREATE INDEX "idx_notification_types_category_id" ON "notification_types"("notification_category_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_types_code" ON "notification_types"("code" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "notification_types" ADD CONSTRAINT "notification_types_code_key" UNIQUE ("code");

-- CreateIndex
CREATE INDEX "notification_types_is_active" ON "notification_types"("is_active" ASC);

-- CreateIndex
CREATE INDEX "notification_types_priority" ON "notification_types"("priority" ASC);

-- CreateIndex
CREATE INDEX "notifications_email_next_retry_at" ON "notifications"("email_next_retry_at" ASC);

-- CreateIndex
CREATE INDEX "notifications_notification_type_id" ON "notifications"("notification_type_id" ASC);

-- CreateIndex
CREATE INDEX "notifications_push_next_retry_at" ON "notifications"("push_next_retry_at" ASC);

-- CreateIndex
CREATE INDEX "notifications_related_entity_type_related_entity_id" ON "notifications"("related_entity_type" ASC, "related_entity_id" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_id" ON "notifications"("user_id" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at" ON "notifications"("user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at" ON "notifications"("user_id" ASC, "is_read" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_person_contacts_email_hash" ON "person_contacts"("email_hash" ASC);

-- CreateIndex
CREATE INDEX "idx_person_contacts_origin_session_id" ON "person_contacts"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_person_contacts_phone_primary_hash" ON "person_contacts"("phone_primary_hash" ASC);

-- CreateIndex
CREATE INDEX "idx_person_contacts_phone_secondary_hash" ON "person_contacts"("phone_secondary_hash" ASC);

-- CreateIndex
CREATE INDEX "person_contacts_email" ON "person_contacts"("email" ASC);

-- CreateIndex
CREATE INDEX "person_contacts_email_email_verified_at" ON "person_contacts"("email" ASC, "email_verified_at" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_email_hash_key" UNIQUE ("email_hash");

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_email_key" UNIQUE ("email");

-- CreateIndex
CREATE INDEX "person_contacts_email_verified_at" ON "person_contacts"("email_verified_at" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_person_id_key" UNIQUE ("person_id");

-- CreateIndex
CREATE INDEX "person_contacts_phone_primary" ON "person_contacts"("phone_primary" ASC);

-- CreateIndex
CREATE INDEX "person_contacts_phone_primary_verified_at" ON "person_contacts"("phone_primary_verified_at" ASC);

-- CreateIndex
CREATE INDEX "person_contacts_phone_secondary" ON "person_contacts"("phone_secondary" ASC);

-- CreateIndex
CREATE INDEX "idx_person_locations_origin_session_id" ON "person_locations"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "person_locations_city_id" ON "person_locations"("city_id" ASC);

-- CreateIndex
CREATE INDEX "person_locations_country_id" ON "person_locations"("country_id" ASC);

-- CreateIndex
CREATE INDEX "person_locations_department_id" ON "person_locations"("department_id" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "person_locations" ADD CONSTRAINT "person_locations_person_id_key" UNIQUE ("person_id");

-- CreateIndex
CREATE INDEX "idx_person_references_origin_session_id" ON "person_references"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_person_references_person_active" ON "person_references"("person_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE INDEX "idx_person_references_person_id" ON "person_references"("person_id" ASC);

-- CreateIndex
CREATE INDEX "idx_person_references_type" ON "person_references"("reference_type" ASC);

-- CreateIndex
CREATE INDEX "idx_persons_national_id_hash" ON "persons"("national_id_hash" ASC);

-- CreateIndex
CREATE INDEX "idx_persons_origin_session_id" ON "persons"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "persons_country_id" ON "persons"("country_id" ASC);

-- CreateIndex
CREATE INDEX "persons_deleted_at" ON "persons"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "persons_document_type_id" ON "persons"("document_type_id" ASC);

-- CreateIndex
CREATE INDEX "persons_first_name_last_name" ON "persons"("first_name" ASC, "last_name" ASC);

-- CreateIndex
CREATE INDEX "persons_gender_id" ON "persons"("gender_id" ASC);

-- CreateIndex
CREATE INDEX "persons_national_id" ON "persons"("national_id" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "persons" ADD CONSTRAINT "persons_national_id_hash_key" UNIQUE ("national_id_hash");

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "persons" ADD CONSTRAINT "persons_national_id_key" UNIQUE ("national_id");

-- CreateIndex
CREATE INDEX "phone_prefixes_country_id" ON "phone_prefixes"("country_id" ASC);

-- CreateIndex
CREATE INDEX "phone_prefixes_is_active" ON "phone_prefixes"("is_active" ASC);

-- CreateIndex
CREATE INDEX "phone_prefixes_prefix" ON "phone_prefixes"("prefix" ASC);

-- CreateIndex
CREATE INDEX "privacy_policies_is_active_idx" ON "privacy_policies"("is_active" ASC);

-- CreateIndex
CREATE INDEX "privacy_policies_version_idx" ON "privacy_policies"("version" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "privacy_policies" ADD CONSTRAINT "privacy_policies_version_key" UNIQUE ("version");

-- CreateIndex
CREATE INDEX "provider_fallback_events_circuit_product" ON "provider_fallback_events"("circuit_product" ASC);

-- CreateIndex
CREATE INDEX "provider_fallback_events_ended_at" ON "provider_fallback_events"("ended_at" ASC);

-- CreateIndex
CREATE INDEX "provider_fallback_events_provider" ON "provider_fallback_events"("provider" ASC);

-- CreateIndex
CREATE INDEX "provider_fallback_events_provider_ended_at" ON "provider_fallback_events"("provider" ASC, "ended_at" ASC);

-- CreateIndex
CREATE INDEX "provider_fallback_events_started_at" ON "provider_fallback_events"("started_at" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_deleted_at" ON "reset_credentials"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_email" ON "reset_credentials"("email" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_expires_at" ON "reset_credentials"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_origin_session_id" ON "reset_credentials"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_token" ON "reset_credentials"("token" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_token_validation" ON "reset_credentials"("token" ASC, "used" ASC, "expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_type" ON "reset_credentials"("type" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_used" ON "reset_credentials"("used" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_user_id" ON "reset_credentials"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reset_credentials_user_type_used" ON "reset_credentials"("user_id" ASC, "type" ASC, "used" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "reset_credentials" ADD CONSTRAINT "reset_credentials_token_key" UNIQUE ("token");

-- CreateIndex
CREATE INDEX "idx_role_permission_overrides_origin_session_id" ON "role_permission_overrides"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_role_permission_overrides_role_name" ON "role_permission_overrides"("role_name" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "role_permission_overrides" ADD CONSTRAINT "uq_role_permission_overrides_role_module_action" UNIQUE ("role_name", "module_name", "action");

-- CreateIndex
CREATE INDEX "roles_is_active" ON "roles"("is_active" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "roles" ADD CONSTRAINT "roles_name_key" UNIQUE ("name");

-- CreateIndex
CREATE INDEX "sms_delivery_attempts_created_at" ON "sms_delivery_attempts"("created_at" ASC);

-- CreateIndex
CREATE INDEX "sms_delivery_attempts_phone_hash" ON "sms_delivery_attempts"("phone_hash" ASC);

-- CreateIndex
CREATE INDEX "sms_delivery_attempts_status" ON "sms_delivery_attempts"("status" ASC);

-- CreateIndex
CREATE INDEX "sms_delivery_attempts_user_id" ON "sms_delivery_attempts"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_system_global_config_origin_session_id" ON "system_global_config"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "system_global_config_config_version" ON "system_global_config"("config_version" ASC);

-- CreateIndex
CREATE INDEX "system_global_config_created_at" ON "system_global_config"("created_at" ASC);

-- CreateIndex
CREATE INDEX "system_global_config_is_active" ON "system_global_config"("is_active" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "system_global_config" ADD CONSTRAINT "system_global_config_unique_active" UNIQUE ("is_active");

-- CreateIndex
CREATE INDEX "idx_biometric_credentials_device_id" ON "user_biometric_credentials"("user_trusted_device_id" ASC);

-- CreateIndex
CREATE INDEX "idx_biometric_credentials_user_id" ON "user_biometric_credentials"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_biometric_credentials_credential_id" ON "user_biometric_credentials"("credential_id" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "user_biometric_credentials" ADD CONSTRAINT "user_biometric_credentials_credential_id_key" UNIQUE ("credential_id");

-- CreateIndex
CREATE INDEX "idx_user_change_logs_change_type" ON "user_change_logs"("change_type" ASC);

-- CreateIndex
CREATE INDEX "idx_user_change_logs_changed_by" ON "user_change_logs"("changed_by_user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_change_logs_created_at" ON "user_change_logs"("created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_user_change_logs_origin_session_id" ON "user_change_logs"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_change_logs_user_id" ON "user_change_logs"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_consents_origin_session_id" ON "user_consents"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "user_consents_granted_at_idx" ON "user_consents"("granted_at" ASC);

-- CreateIndex
CREATE INDEX "user_consents_is_current_idx" ON "user_consents"("is_current" ASC);

-- CreateIndex
CREATE INDEX "user_consents_user_id_idx" ON "user_consents"("user_id" ASC);

-- CreateIndex
CREATE INDEX "user_consents_user_type_idx" ON "user_consents"("user_id" ASC, "consent_type_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_login_attempts_national_id_hash" ON "user_login_attempts"("national_id_hash" ASC);

-- CreateIndex
CREATE INDEX "idx_user_login_attempts_origin_session_id" ON "user_login_attempts"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_attempted_at" ON "user_login_attempts"("attempted_at" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_blocked_until" ON "user_login_attempts"("blocked_until" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_ip_address" ON "user_login_attempts"("ip_address" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_ip_address_attempted_at" ON "user_login_attempts"("ip_address" ASC, "attempted_at" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_success" ON "user_login_attempts"("success" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_user_id" ON "user_login_attempts"("user_id" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_user_id_attempted_at_success" ON "user_login_attempts"("user_id" ASC, "attempted_at" ASC, "success" ASC);

-- CreateIndex
CREATE INDEX "user_login_attempts_username_attempt" ON "user_login_attempts"("username_attempt" ASC);

-- CreateIndex
CREATE INDEX "idx_unp_notification_category_code" ON "user_notification_preferences"("notification_category_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "idx_unp_user_id_notification_category_code" ON "user_notification_preferences"("user_id" ASC, "notification_category_code" ASC);

-- CreateIndex
CREATE INDEX "idx_user_notification_preferences_origin_session_id" ON "user_notification_preferences"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "user_notification_preferences_user_id" ON "user_notification_preferences"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_push_tokens_origin_session_id" ON "user_push_tokens"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "user_push_tokens_is_active" ON "user_push_tokens"("is_active" ASC);

-- CreateIndex
CREATE INDEX "user_push_tokens_platform" ON "user_push_tokens"("platform" ASC);

-- CreateIndex
CREATE INDEX "user_push_tokens_user_id" ON "user_push_tokens"("user_id" ASC);

-- CreateIndex
CREATE INDEX "user_push_tokens_user_id_is_active" ON "user_push_tokens"("user_id" ASC, "is_active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_push_tokens_user_id_token" ON "user_push_tokens"("user_id" ASC, "token" ASC);

-- CreateIndex
CREATE INDEX "idx_user_sessions_user_id_status" ON "user_sessions"("user_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "user_sessions_device_id" ON "user_sessions"("device_id" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_jti_key" UNIQUE ("jti");

-- CreateIndex
CREATE INDEX "user_sessions_started_at" ON "user_sessions"("started_at" ASC);

-- CreateIndex
CREATE INDEX "user_sessions_status" ON "user_sessions"("status" ASC);

-- CreateIndex
CREATE INDEX "user_sessions_user_id" ON "user_sessions"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_trusted_devices_fingerprint_hash" ON "user_trusted_devices"("fingerprint_hash" ASC);

-- CreateIndex
CREATE INDEX "idx_user_trusted_devices_last_seen_at" ON "user_trusted_devices"("last_seen_at" ASC);

-- CreateIndex
CREATE INDEX "idx_user_trusted_devices_origin_session_id" ON "user_trusted_devices"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_trusted_devices_user_id" ON "user_trusted_devices"("user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_user_trusted_devices_user_status" ON "user_trusted_devices"("user_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_trusted_devices_user_fingerprint" ON "user_trusted_devices"("user_id" ASC, "fingerprint_hash" ASC);

-- CreateIndex
CREATE INDEX "idx_users_deleted_at" ON "users"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "idx_users_sms_mfa_enabled" ON "users"("sms_mfa_enabled" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "users" ADD CONSTRAINT "users_cognito_username_key" UNIQUE ("auth_username");

-- CreateIndex
CREATE INDEX "users_deleted_at" ON "users"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "users_is_active" ON "users"("is_active" ASC);

-- CreateIndex
CREATE INDEX "users_person_id" ON "users"("person_id" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_key" UNIQUE ("person_id");

-- CreateIndex
CREATE INDEX "users_privacy_policy_version_idx" ON "users"("privacy_policy_version" ASC);

-- CreateIndex
CREATE INDEX "users_role_id" ON "users"("role_id" ASC);

-- CreateIndex
CREATE INDEX "users_username" ON "users"("username" ASC);

-- AddUniqueConstraint (Sequelize los creaba como constraint, no como índice)
ALTER TABLE "users" ADD CONSTRAINT "users_username_key" UNIQUE ("username");

-- CreateIndex
CREATE INDEX "idx_verification_codes_origin_session_id" ON "verification_codes"("origin_session_id" ASC);

-- CreateIndex
CREATE INDEX "verification_codes_contact_value" ON "verification_codes"("contact_value" ASC);

-- CreateIndex
CREATE INDEX "verification_codes_contact_value_type_expires_at" ON "verification_codes"("contact_value" ASC, "type" ASC, "expires_at" ASC);

-- CreateIndex
CREATE INDEX "verification_codes_expires_at" ON "verification_codes"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "verification_codes_type" ON "verification_codes"("type" ASC);

-- CreateIndex
CREATE INDEX "verification_codes_verified_at" ON "verification_codes"("verified_at" ASC);

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_second_approver_id_fkey" FOREIGN KEY ("second_approver_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_avatar_theme_id_fkey" FOREIGN KEY ("avatar_theme_id") REFERENCES "avatar_themes"("avatar_theme_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_challenges" ADD CONSTRAINT "biometric_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("country_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_bounce_suppressions" ADD CONSTRAINT "email_bounce_suppressions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_notification_reads" ADD CONSTRAINT "global_notification_reads_global_notification_id_fkey" FOREIGN KEY ("global_notification_id") REFERENCES "global_notifications"("global_notification_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_notification_reads" ADD CONSTRAINT "global_notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_notifications" ADD CONSTRAINT "global_notifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_notifications" ADD CONSTRAINT "global_notifications_notification_type_id_fkey" FOREIGN KEY ("notification_type_id") REFERENCES "notification_types"("notification_type_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_types" ADD CONSTRAINT "notification_types_notification_category_id_fkey" FOREIGN KEY ("notification_category_id") REFERENCES "notification_categories"("notification_category_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_notification_type_id_fkey" FOREIGN KEY ("notification_type_id") REFERENCES "notification_types"("notification_type_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_phone_primary_prefix_id_fkey" FOREIGN KEY ("phone_primary_prefix_id") REFERENCES "phone_prefixes"("phone_prefix_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_phone_secondary_prefix_id_fkey" FOREIGN KEY ("phone_secondary_prefix_id") REFERENCES "phone_prefixes"("phone_prefix_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_locations" ADD CONSTRAINT "person_locations_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("city_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_locations" ADD CONSTRAINT "person_locations_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("country_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_locations" ADD CONSTRAINT "person_locations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_locations" ADD CONSTRAINT "person_locations_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_references" ADD CONSTRAINT "person_references_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("country_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("document_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_gender_id_fkey" FOREIGN KEY ("gender_id") REFERENCES "genders"("gender_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_prefixes" ADD CONSTRAINT "phone_prefixes_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("country_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reset_credentials" ADD CONSTRAINT "reset_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission_overrides" ADD CONSTRAINT "role_permission_overrides_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_delivery_attempts" ADD CONSTRAINT "sms_delivery_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_biometric_credentials" ADD CONSTRAINT "user_biometric_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_biometric_credentials" ADD CONSTRAINT "user_biometric_credentials_user_trusted_device_id_fkey" FOREIGN KEY ("user_trusted_device_id") REFERENCES "user_trusted_devices"("user_trusted_device_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_change_logs" ADD CONSTRAINT "user_change_logs_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_change_logs" ADD CONSTRAINT "user_change_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_consent_type_id_fkey" FOREIGN KEY ("consent_type_id") REFERENCES "consent_types"("consent_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_privacy_policy_id_fkey" FOREIGN KEY ("privacy_policy_id") REFERENCES "privacy_policies"("privacy_policy_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_login_attempts" ADD CONSTRAINT "user_login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_notification_category_code_fkey" FOREIGN KEY ("notification_category_code") REFERENCES "notification_categories"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_push_tokens" ADD CONSTRAINT "user_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_trusted_devices"("user_trusted_device_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_trusted_devices" ADD CONSTRAINT "user_trusted_devices_approved_by_device_id_fkey" FOREIGN KEY ("approved_by_device_id") REFERENCES "user_trusted_devices"("user_trusted_device_id") ON DELETE SET NULL ON UPDATE SET NULL;

-- AddForeignKey
ALTER TABLE "user_trusted_devices" ADD CONSTRAINT "user_trusted_devices_blocked_by_device_id_fkey" FOREIGN KEY ("blocked_by_device_id") REFERENCES "user_trusted_devices"("user_trusted_device_id") ON DELETE SET NULL ON UPDATE SET NULL;

-- AddForeignKey
ALTER TABLE "user_trusted_devices" ADD CONSTRAINT "user_trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("avatar_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Objetos que el schema de Prisma no modela (SQL crudo) ─────────────────────────────────────────

-- consent_types.scope: hoy solo ONBOARDING
ALTER TABLE "consent_types" ADD CONSTRAINT "consent_types_scope_check" CHECK (scope IN ('ONBOARDING'));

-- user_change_logs: registro regulatorio permanente, append-only (sin UPDATE ni DELETE)
CREATE OR REPLACE FUNCTION trg_fn_user_change_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'user_change_logs is append-only: % not permitted (registro regulatorio permanente)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_change_logs_immutable
BEFORE UPDATE OR DELETE ON "user_change_logs"
FOR EACH ROW EXECUTE FUNCTION trg_fn_user_change_logs_immutable();

-- audit_logs: append-only; DELETE solo con app.allow_audit_purge = true (audit-archive.worker)
CREATE OR REPLACE FUNCTION trg_fn_audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_audit_purge', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only: % not permitted (Circular 052 SFC)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_logs_immutable();

-- ── Comentarios de tablas y columnas (los ponían las migraciones de Sequelize) ──────────────────────
COMMENT ON COLUMN "approval_requests"."operation_key" IS 'Calza con el registro DUAL_APPROVAL_OPS (shared/constants/dual-approval.js)';
COMMENT ON COLUMN "approval_requests"."entity_type" IS 'Tipo de entidad afectada, ej: Role, NotificationType';
COMMENT ON COLUMN "approval_requests"."entity_id" IS 'Id de la entidad afectada (para join/annotate de pendientes)';
COMMENT ON COLUMN "approval_requests"."payload" IS 'Datos que el handler registrado necesita para ejecutar la acción real al aprobar';
COMMENT ON COLUMN "approval_requests"."requested_by" IS 'Maker — funcionario que originó la operación. NOT NULL → RESTRICT (SET NULL es inválido sobre NOT NULL; RESTRICT preserva la trazabilidad al impedir el borrado).';
COMMENT ON COLUMN "approval_requests"."status" IS 'Estado de la doble aprobación';
COMMENT ON COLUMN "approval_requests"."second_approver_id" IS 'Checker — segundo funcionario que resolvió';
COMMENT ON COLUMN "approval_requests"."expires_at" IS 'Calculado con ttlHours del registro (horas hábiles)';
COMMENT ON COLUMN "approval_requests"."result" IS 'Salida del handler al aprobar (ej: id de entidad creada)';
COMMENT ON COLUMN "approval_requests"."origin_session_id" IS 'session_id de auth que solicitó la operación sujeta a doble aprobación';
COMMENT ON COLUMN "approval_requests"."origin_correlation_id" IS 'correlationId del request que solicitó la operación sujeta a doble aprobación';
COMMENT ON COLUMN "audit_alerts"."audit_log_id" IS 'Referencia al log de auditoría que originó la alerta. Sin FK — independencia regulatoria.';
COMMENT ON COLUMN "audit_alerts"."action" IS 'Código de la acción que originó la alerta';
COMMENT ON COLUMN "audit_alerts"."category" IS 'Módulo origen de la alerta';
COMMENT ON COLUMN "audit_alerts"."user_id" IS 'Usuario que originó la acción que generó la alerta';
COMMENT ON COLUMN "audit_alerts"."entity_id" IS 'ID de la entidad afectada (ej: entidad, ApprovalRequest, rol)';
COMMENT ON COLUMN "audit_alerts"."entity_type" IS 'Tipo de entidad afectada (ej: Person, ApprovalRequest, NotificationType)';
COMMENT ON COLUMN "audit_alerts"."message" IS 'Descripción legible de la alerta';
COMMENT ON COLUMN "audit_alerts"."acknowledged_by" IS 'Admin que reconoció la alerta. Sin FK — independencia regulatoria.';
COMMENT ON COLUMN "audit_logs"."action" IS 'Código de acción — ej: SCREENING_CREATED, LOGIN_FAILED';
COMMENT ON COLUMN "audit_logs"."description" IS 'Descripción legible para humanos — ej: Creación de screening KYC inicial';
COMMENT ON COLUMN "audit_logs"."category" IS 'Módulo origen — ej: KYC, Autenticación, Notificaciones';
COMMENT ON COLUMN "audit_logs"."risk" IS 'Nivel de sensibilidad regulatoria';
COMMENT ON COLUMN "audit_logs"."outcome" IS 'Resultado de la operación — success | failure | warning | attempt';
COMMENT ON COLUMN "audit_logs"."http_status" IS 'Código HTTP de la respuesta — ej: 200, 422, 500';
COMMENT ON COLUMN "audit_logs"."error_code" IS 'Código de error de la aplicación — ej: VALIDATION_ERROR, NOT_FOUND';
COMMENT ON COLUMN "audit_logs"."error_message" IS 'Mensaje de error legible para auditoría regulatoria';
COMMENT ON COLUMN "audit_logs"."user_id" IS 'Usuario que ejecutó la acción — null si es acción de sistema/worker';
COMMENT ON COLUMN "audit_logs"."correlation_id" IS 'ID de trazabilidad de la request HTTP';
COMMENT ON COLUMN "audit_logs"."ip" IS 'IP de origen — soporta IPv6';
COMMENT ON COLUMN "audit_logs"."fingerprint" IS 'SHA-256 del device fingerprint';
COMMENT ON COLUMN "audit_logs"."method" IS 'Método HTTP — GET, POST, PUT, etc.';
COMMENT ON COLUMN "audit_logs"."path" IS 'Path de la request que originó la acción';
COMMENT ON COLUMN "audit_logs"."details" IS 'Datos adicionales específicos de la acción';
COMMENT ON COLUMN "audit_logs"."source" IS 'Origen del log — http | worker | system';
COMMENT ON COLUMN "audit_logs"."entity_id" IS 'ID de la entidad afectada. Null en eventos sin entidad (listados, sesiones, etc.).';
COMMENT ON COLUMN "audit_logs"."entity_type" IS 'Tipo de entidad afectada. Ej: User, Person, Role, ApprovalRequest, NotificationType.';
COMMENT ON COLUMN "audit_logs"."entity_table" IS 'Nombre exacto de la tabla afectada. Ej: users, user_trusted_devices, notification_types.';
COMMENT ON COLUMN "audit_logs"."module" IS 'Módulo de la matriz RBAC. Inferido del campo module definido en cada AUDIT_ACTION. Ej: client, admin, shared.';
COMMENT ON COLUMN "audit_logs"."session_id" IS 'Sesión (user_sessions.user_session_id) desde la que se originó la acción. Null en workers/sistema.';
COMMENT ON COLUMN "biometric_challenges"."user_id" IS 'Usuario al que pertenece el challenge. Null solo en register/start.';
COMMENT ON COLUMN "biometric_challenges"."challenge" IS 'Nonce aleatorio en base64url. Firmado por el dispositivo para probar posesión de la llave privada.';
COMMENT ON COLUMN "biometric_challenges"."type" IS 'registration | authentication';
COMMENT ON COLUMN "biometric_challenges"."used" IS 'true después de ser consumido — impide reutilización (replay attack)';
COMMENT ON COLUMN "biometric_challenges"."expires_at" IS 'TTL del challenge — normalmente 5 minutos desde su creación';
COMMENT ON COLUMN "cities"."dane_code" IS 'Código DANE numérico del departamento (3 dígitos). Requerido para reportes DIAN.';
COMMENT ON COLUMN "consent_types"."code" IS 'Identificador único de la finalidad — ej: PRIVACY_POLICY, CREDIT_BUREAU_QUERY';
COMMENT ON COLUMN "consent_types"."is_mandatory" IS 'false = consentimiento opcional (ej: marketing); no puede ser condición de acceso';
COMMENT ON COLUMN "consent_types"."is_revocable" IS 'true = el usuario puede revocarlo en cualquier momento';
COMMENT ON COLUMN "consent_types"."scope" IS 'Momento en que se captura el consentimiento. ONBOARDING = durante la vinculación. Punto de extensión: agrega tus propios scopes (y actualiza el CHECK) para gatear operaciones de tu dominio.';
COMMENT ON COLUMN "countries"."code" IS 'ISO 3166-1 alpha-3 code';
COMMENT ON COLUMN "departments"."dane_code" IS 'Código DANE numérico del departamento (2 dígitos). Requerido para reportes DIAN.';
COMMENT ON COLUMN "document_types"."code" IS 'Sigla del tipo de documento — ej: CC, CE, TI, PA, PPT, SYSTEM';
COMMENT ON COLUMN "document_types"."name" IS 'Nombre completo del tipo de documento — ej: Cédula de Ciudadanía';
COMMENT ON COLUMN "document_types"."is_visible_to_client" IS 'Si es false, el tipo es interno y no se muestra al cliente';
COMMENT ON COLUMN "global_notification_reads"."origin_session_id" IS 'session_id de auth que marcó la notificación como leída';
COMMENT ON COLUMN "global_notification_reads"."origin_correlation_id" IS 'correlationId del request que marcó la notificación como leída';
COMMENT ON COLUMN "global_notifications"."batch_size" IS 'Usuarios por lote para AWS SES/SNS';
COMMENT ON COLUMN "global_notifications"."processing_started_at" IS 'Cuándo empezó el procesamiento';
COMMENT ON COLUMN "global_notifications"."processing_completed_at" IS 'Cuándo terminó el procesamiento';
COMMENT ON COLUMN "global_notifications"."total_target_users" IS 'Cantidad total de usuarios elegibles';
COMMENT ON COLUMN "notification_categories"."allow_dnd" IS 'false → el usuario no puede silenciar (se ignora su quiet hours para esta categoría)';
COMMENT ON COLUMN "notification_categories"."is_critical" IS 'true → emergencia: ignora quiet hours y no es silenciable';
COMMENT ON COLUMN "notification_categories"."email_layout_template" IS 'Layout HTML+CSS base; debe contener el placeholder {{content}} donde se inyecta el body del tipo';
COMMENT ON COLUMN "notifications"."scheduled_for" IS 'Para quiet_hours - cuándo debe enviarse';
COMMENT ON COLUMN "notifications"."priority" IS '1-10, para ordenar cola de envíos';
COMMENT ON COLUMN "notifications"."processing_status" IS 'pending, processing, completed, failed';
COMMENT ON COLUMN "notifications"."retry_count" IS 'Número de reintentos de entrega realizados por el notification worker';
COMMENT ON COLUMN "person_contacts"."email" IS 'Cifrado AES-256-GCM';
COMMENT ON COLUMN "person_contacts"."email_hash" IS 'HMAC-SHA256(email, HASH_PEPPER) — solo para búsquedas WHERE';
COMMENT ON COLUMN "person_contacts"."phone_primary" IS 'Cifrado AES-256-GCM';
COMMENT ON COLUMN "person_contacts"."phone_primary_hash" IS 'HMAC-SHA256(phone_primary, HASH_PEPPER) — solo para búsquedas WHERE';
COMMENT ON COLUMN "person_contacts"."phone_secondary" IS 'Cifrado AES-256-GCM';
COMMENT ON COLUMN "person_contacts"."phone_secondary_hash" IS 'HMAC-SHA256(phone_secondary, HASH_PEPPER) — solo para búsquedas WHERE';
COMMENT ON COLUMN "person_contacts"."origin_session_id" IS 'session_id de auth que registró el contacto';
COMMENT ON COLUMN "person_contacts"."origin_correlation_id" IS 'correlationId del request que registró el contacto';
COMMENT ON COLUMN "person_locations"."origin_session_id" IS 'session_id de auth que registró la ubicación';
COMMENT ON COLUMN "person_locations"."origin_correlation_id" IS 'correlationId del request que registró la ubicación';
COMMENT ON COLUMN "person_references"."person_id" IS 'Persona dueña de la referencia';
COMMENT ON COLUMN "person_references"."reference_name" IS 'Nombre completo de la referencia';
COMMENT ON COLUMN "person_references"."reference_phone" IS 'Teléfono de contacto de la referencia';
COMMENT ON COLUMN "person_references"."reference_type" IS 'Tipo de referencia: conocido (amigo, colega) o familiar';
COMMENT ON COLUMN "person_references"."is_active" IS 'false cuando el cliente la elimina (soft delete)';
COMMENT ON COLUMN "person_references"."origin_session_id" IS 'session_id de auth que registró la referencia';
COMMENT ON COLUMN "person_references"."origin_correlation_id" IS 'correlationId del request que registró la referencia';
COMMENT ON COLUMN "persons"."national_id" IS 'Cifrado AES-256-GCM — formato: ivHex:authTagHex:ciphertextHex';
COMMENT ON COLUMN "persons"."national_id_hash" IS 'HMAC-SHA256(national_id, HASH_PEPPER) — solo para búsquedas WHERE';
COMMENT ON COLUMN "persons"."document_type_id" IS 'Tipo de documento de identidad — FK a document_types';
COMMENT ON COLUMN "persons"."origin_session_id" IS 'session_id de auth que creó la persona';
COMMENT ON COLUMN "persons"."origin_correlation_id" IS 'correlationId del request que creó la persona';
COMMENT ON COLUMN "phone_prefixes"."prefix" IS 'Phone prefix with + (e.g., +56, +1)';
COMMENT ON COLUMN "privacy_policies"."version" IS 'Versión semántica del documento (ej: "1.0", "1.1", "2.0")';
COMMENT ON COLUMN "privacy_policies"."document_url" IS 'URL pública del PDF (repositorio o S3)';
COMMENT ON COLUMN "privacy_policies"."document_hash" IS 'Hash SHA-256 (hex) del archivo para verificación de integridad (RF-ADM-05 CA-2)';
COMMENT ON COLUMN "privacy_policies"."summary" IS 'Resumen de los cambios respecto a la versión anterior';
COMMENT ON COLUMN "privacy_policies"."is_active" IS 'Solo una versión puede estar activa a la vez';
COMMENT ON COLUMN "privacy_policies"."effective_date" IS 'Fecha desde la que esta versión entra en vigor';
COMMENT ON COLUMN "reset_credentials"."user_id" IS 'Usuario asociado al token de reseteo';
COMMENT ON COLUMN "reset_credentials"."token" IS 'Token único para resetear credenciales (URL segura)';
COMMENT ON COLUMN "reset_credentials"."email" IS 'Email del usuario al momento de solicitar el reseteo';
COMMENT ON COLUMN "reset_credentials"."type" IS 'Tipo de reseteo: mfa (recuperación MFA) o password (cambio contraseña)';
COMMENT ON COLUMN "reset_credentials"."expires_at" IS 'Fecha de expiración del token';
COMMENT ON COLUMN "reset_credentials"."used" IS 'Indica si el token ya fue utilizado';
COMMENT ON COLUMN "reset_credentials"."used_at" IS 'Fecha en la que se utilizó el token';
COMMENT ON COLUMN "reset_credentials"."origin_session_id" IS 'session_id de auth que solicitó el restablecimiento';
COMMENT ON COLUMN "reset_credentials"."origin_correlation_id" IS 'correlationId del request que solicitó el restablecimiento';
COMMENT ON COLUMN "reset_credentials"."deletedAt" IS 'Soft delete timestamp';
COMMENT ON COLUMN "system_global_config"."config_version" IS 'Version number for configuration tracking';
COMMENT ON COLUMN "system_global_config"."is_active" IS 'Whether this configuration is currently active (only one active at a time)';
COMMENT ON COLUMN "system_global_config"."currency" IS 'Currency code (ISO 4217)';
COMMENT ON COLUMN "system_global_config"."audit_retention_hot_years" IS 'Años de retención de logs en almacenamiento caliente (BD consultable). Mínimo 5 según Circular 100 SFC.';
COMMENT ON COLUMN "system_global_config"."audit_retention_cold_years" IS 'Años de retención de logs en almacenamiento frío (S3 Glacier). Mínimo 10 según Circular 100 SFC.';
COMMENT ON COLUMN "system_global_config"."audit_hot_purge_enabled" IS 'Interruptor de la purga del almacenamiento caliente (RF-ADM-03 CA-3). Cuando es true, el worker audit-archive elimina de la BD los audit_logs que superaron audit_retention_hot_years (la copia permanece en S3/frío). Default false: operación destructiva, la enciende el Superadministrador.';
COMMENT ON COLUMN "system_global_config"."integration_resilience" IS 'Resiliencia homologada de TODAS las integraciones salientes (RF-INT-01 CA-6). Estructura: { timeout_ms, manual_review_timeout_ms (fast-fail originación manual RF-CRE-04), max_retries, circuit_breaker: { failure_threshold, recovery_time_ms, failures_ttl_s } }. Un solo valor para todos (sin overrides por proveedor). El circuit breaker y los clientes lo leen vía ResilienceConfigResolver (caché 60s) con fallback duro a estos defaults.';
COMMENT ON COLUMN "system_global_config"."promotional_banners" IS 'Banners promocionales que consume el front (landing pública + app cliente). Array de objetos { id, title, text, tag, button_route, image_url, is_active, sort_order }. La imagen vive en el bucket público (URL CloudFront) y se sube desde el mantenedor admin de banners.';
COMMENT ON COLUMN "system_global_config"."origin_session_id" IS 'session_id de auth que actualizó la configuración global';
COMMENT ON COLUMN "system_global_config"."origin_correlation_id" IS 'correlationId del request que actualizó la configuración global';
COMMENT ON COLUMN "user_biometric_credentials"."user_id" IS 'Usuario dueño de la credencial biométrica';
COMMENT ON COLUMN "user_biometric_credentials"."user_trusted_device_id" IS 'Dispositivo en el que está registrada la huella. Si se elimina el dispositivo, se elimina la credencial.';
COMMENT ON COLUMN "user_biometric_credentials"."credential_id" IS 'ID único generado por el dispositivo móvil (base64url)';
COMMENT ON COLUMN "user_biometric_credentials"."public_key" IS 'Llave pública ES256 en formato PEM o base64, enviada por el dispositivo en el registro';
COMMENT ON COLUMN "user_biometric_credentials"."sign_count" IS 'Contador de firmas — se incrementa en cada uso. Protege contra ataques de replay.';
COMMENT ON COLUMN "user_biometric_credentials"."is_active" IS 'Permite desactivar una credencial sin eliminarla';
COMMENT ON COLUMN "user_biometric_credentials"."last_used_at" IS 'Último login biométrico exitoso con esta credencial';
COMMENT ON COLUMN "user_change_logs"."user_id" IS 'Usuario afectado por el cambio';
COMMENT ON COLUMN "user_change_logs"."changed_by_user_id" IS 'Usuario que realizó el cambio (null si fue el sistema)';
COMMENT ON COLUMN "user_change_logs"."changed_by_role" IS 'Rol del que hizo el cambio';
COMMENT ON COLUMN "user_change_logs"."change_type" IS 'Tipo de cambio realizado';
COMMENT ON COLUMN "user_change_logs"."previous_value" IS 'Valor anterior (null para password por seguridad)';
COMMENT ON COLUMN "user_change_logs"."new_value" IS 'Valor nuevo (null para password por seguridad)';
COMMENT ON COLUMN "user_change_logs"."change_reason" IS 'Razón del cambio (opcional)';
COMMENT ON COLUMN "user_change_logs"."ip_address" IS 'IP desde donde se hizo el cambio';
COMMENT ON COLUMN "user_change_logs"."user_agent" IS 'Navegador/dispositivo usado';
COMMENT ON COLUMN "user_change_logs"."origin_session_id" IS 'session_id de auth que originó el cambio';
COMMENT ON COLUMN "user_change_logs"."origin_correlation_id" IS 'correlationId del request que originó el cambio';
COMMENT ON COLUMN "user_consents"."privacy_policy_id" IS 'Solo aplica para el tipo PRIVACY_POLICY — versión específica aceptada';
COMMENT ON COLUMN "user_consents"."is_current" IS 'true = registro activo para este user+consent_type. Solo uno activo a la vez.';
COMMENT ON COLUMN "user_consents"."origin_session_id" IS 'session_id de auth que otorgó el consentimiento';
COMMENT ON COLUMN "user_consents"."origin_correlation_id" IS 'correlationId del request que otorgó el consentimiento';
COMMENT ON COLUMN "user_login_attempts"."user_id" IS 'Null if user not found';
COMMENT ON COLUMN "user_login_attempts"."username_attempt" IS 'Username de cognito';
COMMENT ON COLUMN "user_login_attempts"."national_id" IS 'Cifrado AES-256-GCM';
COMMENT ON COLUMN "user_login_attempts"."national_id_hash" IS 'HMAC-SHA256(national_id, HASH_PEPPER) — solo para búsquedas WHERE';
COMMENT ON COLUMN "user_login_attempts"."ip_address" IS 'IPv4 or IPv6';
COMMENT ON COLUMN "user_login_attempts"."failure_reason" IS 'Invalid credentials, account locked, etc.';
COMMENT ON COLUMN "user_login_attempts"."blocked_until" IS 'When the account/IP will be unblocked';
COMMENT ON COLUMN "user_login_attempts"."origin_session_id" IS 'session_id de auth que originó el intento de login';
COMMENT ON COLUMN "user_login_attempts"."origin_correlation_id" IS 'correlationId del request que originó el intento de login';
COMMENT ON COLUMN "user_notification_preferences"."origin_session_id" IS 'session_id de auth que fijó la preferencia de notificación';
COMMENT ON COLUMN "user_notification_preferences"."origin_correlation_id" IS 'correlationId del request que fijó la preferencia de notificación';
COMMENT ON COLUMN "user_sessions"."user_id" IS 'Sin FK constraint — preserva historial si el usuario es eliminado';
COMMENT ON COLUMN "user_sessions"."device_id" IS 'Dispositivo de confianza asociado — null si aún no registrado';
COMMENT ON COLUMN "user_sessions"."jti" IS 'JTI activo del refresh token — se actualiza en cada rotación';
COMMENT ON COLUMN "user_sessions"."close_reason" IS 'logout | logout_all | revoked_by_admin';
COMMENT ON COLUMN "user_trusted_devices"."user_id" IS 'Usuario propietario del dispositivo';
COMMENT ON COLUMN "user_trusted_devices"."fingerprint_hash" IS 'SHA-256 del User-Agent normalizado (sin IP)';
COMMENT ON COLUMN "user_trusted_devices"."device_name" IS 'Generado automáticamente desde User-Agent, editable por el usuario';
COMMENT ON COLUMN "user_trusted_devices"."status" IS 'pending | trusted | blocked';
COMMENT ON COLUMN "user_trusted_devices"."ip_address" IS 'IP desde la que se registró el dispositivo por primera vez';
COMMENT ON COLUMN "user_trusted_devices"."city" IS 'Ciudad geolocalizada desde ip_address';
COMMENT ON COLUMN "user_trusted_devices"."country" IS 'País geolocalizado desde ip_address';
COMMENT ON COLUMN "user_trusted_devices"."country_code" IS 'Código ISO del país (ej: CL, AR, US)';
COMMENT ON COLUMN "user_trusted_devices"."browser" IS 'Navegador parseado del User-Agent (ej: Chrome, Safari)';
COMMENT ON COLUMN "user_trusted_devices"."os" IS 'Sistema operativo parseado del User-Agent (ej: Windows, iOS)';
COMMENT ON COLUMN "user_trusted_devices"."device_type" IS 'mobile | tablet | desktop';
COMMENT ON COLUMN "user_trusted_devices"."hmac_secret" IS 'Secret HMAC único por dispositivo cifrado AES-256-GCM — entregado al mobile en el login para firmar requests anti-replay';
COMMENT ON COLUMN "user_trusted_devices"."approved_by_device_id" IS 'Dispositivo TRUSTED desde el que se aprobó este dispositivo';
COMMENT ON COLUMN "user_trusted_devices"."approved_at" IS 'Fecha en que un dispositivo trusted aprobó este dispositivo';
COMMENT ON COLUMN "user_trusted_devices"."blocked_by_device_id" IS 'Dispositivo TRUSTED que ejecutó el bloqueo';
COMMENT ON COLUMN "user_trusted_devices"."blocked_at" IS 'Fecha en que el dispositivo fue bloqueado';
COMMENT ON COLUMN "user_trusted_devices"."trusted_at" IS 'Fecha en que el dispositivo pasó a estado trusted (null si aún es pending)';
COMMENT ON COLUMN "user_trusted_devices"."last_seen_at" IS 'Último acceso detectado desde este dispositivo';
COMMENT ON COLUMN "user_trusted_devices"."origin_session_id" IS 'session_id de auth que registró el dispositivo';
COMMENT ON COLUMN "user_trusted_devices"."origin_correlation_id" IS 'correlationId del request que registró el dispositivo';
COMMENT ON COLUMN "users"."password_hash" IS 'Bcrypt hash of password, nullable if using only OAuth';
COMMENT ON COLUMN "users"."auth_username" IS 'Cognito username (username unico)';
COMMENT ON COLUMN "users"."sms_mfa_enabled" IS 'true cuando el usuario tiene SMS MFA activo en Cognito';
COMMENT ON COLUMN "users"."preferred_mfa_method" IS 'Método MFA preferido: none | totp | sms';
COMMENT ON COLUMN "users"."privacy_policy_version" IS 'Versión de la política de privacidad aceptada por el usuario al registrarse';
COMMENT ON COLUMN "users"."privacy_policy_accepted_at" IS 'Fecha y hora exacta en que el usuario aceptó la política de privacidad';
COMMENT ON COLUMN "users"."privacy_policy_accepted_ip" IS 'IP del dispositivo desde el que se aceptó la política (IPv4 o IPv6, máx 45 chars)';
COMMENT ON COLUMN "users"."deleted_at" IS 'Timestamp de eliminación de cuenta (ofuscación irreversible). NULL = no eliminado.';
COMMENT ON COLUMN "users"."totp_secret" IS 'Secreto TOTP (base32) cifrado en reposo con AES-256-GCM. NULL = TOTP no configurado.';
COMMENT ON COLUMN "verification_codes"."contact_value" IS 'Email address or phone number';
COMMENT ON COLUMN "verification_codes"."origin_session_id" IS 'session_id de auth que solicitó el código';
COMMENT ON COLUMN "verification_codes"."origin_correlation_id" IS 'correlationId del request que solicitó el código';
