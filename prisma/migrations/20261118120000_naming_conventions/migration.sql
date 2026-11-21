-- Fase 6c de docs/prisma-migration.md: la base cumple las convenciones de nombres del proyecto y se
-- corrigen los desvíos heredados de Sequelize. Solo metadatos salvo la conversión a enum de los estados
-- de procesamiento (que valida los datos: si hay un valor fuera del enum, la migración falla entera).

-- ── 1. Índices redundantes ────────────────────────────────────────────────────────────────────────
-- Mismas columnas que una PRIMARY KEY o un UNIQUE (que ya crea su índice): no aportan nada y cuestan
-- en cada escritura. La FK de user_notification_preferences a notification_categories(code) se había
-- atado al índice duplicado: se suelta antes y se vuelve a crear sobre el UNIQUE (paso 4).
ALTER TABLE "user_notification_preferences" DROP CONSTRAINT "user_notification_preferences_notification_category_code_fkey";
DROP INDEX "uq_biometric_challenges_challenge";
DROP INDEX "consent_types_code_idx";
DROP INDEX "countries_code";
DROP INDEX "document_types_code";
DROP INDEX "idx_notification_categories_code";
DROP INDEX "notification_types_code";
DROP INDEX "idx_person_contacts_email_hash";
DROP INDEX "person_contacts_email";
DROP INDEX "idx_persons_national_id_hash";
DROP INDEX "persons_national_id";
DROP INDEX "privacy_policies_version_idx";
DROP INDEX "idx_reset_credentials_token";
DROP INDEX "system_global_config_is_active";
DROP INDEX "uq_biometric_credentials_credential_id";
DROP INDEX "users_person_id";
DROP INDEX "users_username";

-- ── 2. Columnas "deletedAt" residuales ────────────────────────────────────────────────────────────
-- Las creó Sequelize (paranoid) y nadie las escribe: el borrado lógico de users es deleted_at. Sus
-- índices (users_deleted_at, persons_deleted_at, idx_reset_credentials_deleted_at) caen con ellas.
ALTER TABLE "users" DROP COLUMN "deletedAt";
ALTER TABLE "persons" DROP COLUMN "deletedAt";
ALTER TABLE "reset_credentials" DROP COLUMN "deletedAt";

-- ── 3. DEFAULT de created_at ──────────────────────────────────────────────────────────────────────
-- Lo ponía la aplicación (Sequelize, después @default(now()) del cliente); ahora también la base, para
-- los INSERT que no pasan por Prisma.
ALTER TABLE "audit_alerts" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "avatar_themes" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "avatars" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "biometric_challenges" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "cities" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "consent_types" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "countries" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "departments" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "document_types" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "email_bounce_suppressions" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "genders" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "global_notifications" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "integration_api_logs" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "notification_categories" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "notification_types" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "notifications" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "person_contacts" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "person_locations" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "person_references" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "persons" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "phone_prefixes" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "privacy_policies" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_fallback_events" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "reset_credentials" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "roles" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sms_delivery_attempts" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_biometric_credentials" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_change_logs" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_consents" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_login_attempts" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_notification_preferences" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_push_tokens" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_trusted_devices" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "verification_codes" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- ── 4. FKs NOT NULL de person_locations ───────────────────────────────────────────────────────────
-- city_id y department_id son NOT NULL pero sus FK tenían ON DELETE SET NULL: borrar una ciudad o un
-- departamento con ubicaciones fallaba por la NOT NULL. RESTRICT dice lo mismo, con el error correcto.
ALTER TABLE "person_locations"
  DROP CONSTRAINT "person_locations_city_id_fkey",
  ADD CONSTRAINT "fk_person_locations_city_id" FOREIGN KEY ("city_id") REFERENCES "cities"("city_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "person_locations"
  DROP CONSTRAINT "person_locations_department_id_fkey",
  ADD CONSTRAINT "fk_person_locations_department_id" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La que se soltó en el paso 1, igual que antes (ahora apoyada en el UNIQUE de notification_categories.code)
ALTER TABLE "user_notification_preferences"
  ADD CONSTRAINT "fk_user_notification_preferences_notification_category_code" FOREIGN KEY ("notification_category_code") REFERENCES "notification_categories"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. Estado de procesamiento de notificaciones: varchar → enum ──────────────────────────────────
-- Los valores son los de NOTIFICATION_PROCESSING_STATUS (shared/constants/domain-enums.ts). Un valor
-- fuera del enum hace fallar el cast y la migración no se aplica (se revierte entera).
CREATE TYPE "enum_notification_processing_status" AS ENUM ('pending', 'processing', 'completed', 'partial_failure', 'failed');

ALTER TABLE "notifications"
  ALTER COLUMN "processing_status" DROP DEFAULT,
  ALTER COLUMN "processing_status" TYPE "enum_notification_processing_status" USING "processing_status"::"enum_notification_processing_status",
  ALTER COLUMN "processing_status" SET DEFAULT 'pending';
ALTER TABLE "global_notifications"
  ALTER COLUMN "push_processing_status" DROP DEFAULT,
  ALTER COLUMN "push_processing_status" TYPE "enum_notification_processing_status" USING "push_processing_status"::"enum_notification_processing_status",
  ALTER COLUMN "push_processing_status" SET DEFAULT 'pending',
  ALTER COLUMN "email_processing_status" DROP DEFAULT,
  ALTER COLUMN "email_processing_status" TYPE "enum_notification_processing_status" USING "email_processing_status"::"enum_notification_processing_status",
  ALTER COLUMN "email_processing_status" SET DEFAULT 'pending';

-- ── 6. Nombres según la convención ────────────────────────────────────────────────────────────────
-- pk_<tabla> · uq_/fk_/ck_<tabla>_<columnas> · idx_<tabla>_<columnas>. Generado con
-- scripts/prisma-migration/db-names.ts (los que ya empezaban con <prefijo>_<tabla>_ se respetan).
ALTER TABLE "approval_requests" RENAME CONSTRAINT "approval_requests_pkey" TO "pk_approval_requests";
ALTER TABLE "approval_requests" RENAME CONSTRAINT "approval_requests_requested_by_fkey" TO "fk_approval_requests_requested_by";
ALTER TABLE "approval_requests" RENAME CONSTRAINT "approval_requests_second_approver_id_fkey" TO "fk_approval_requests_second_approver_id";
ALTER INDEX "audit_alerts_action" RENAME TO "idx_audit_alerts_action";
ALTER INDEX "audit_alerts_created_at" RENAME TO "idx_audit_alerts_created_at";
ALTER TABLE "audit_alerts" RENAME CONSTRAINT "audit_alerts_pkey" TO "pk_audit_alerts";
ALTER INDEX "audit_alerts_user_id" RENAME TO "idx_audit_alerts_user_id";
ALTER INDEX "audit_logs_action" RENAME TO "idx_audit_logs_action";
ALTER INDEX "audit_logs_category" RENAME TO "idx_audit_logs_category";
ALTER INDEX "audit_logs_correlation_id" RENAME TO "idx_audit_logs_correlation_id";
ALTER INDEX "audit_logs_created_at" RENAME TO "idx_audit_logs_created_at";
ALTER INDEX "audit_logs_ip" RENAME TO "idx_audit_logs_ip";
ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_pkey" TO "pk_audit_logs";
ALTER INDEX "audit_logs_risk" RENAME TO "idx_audit_logs_risk";
ALTER INDEX "audit_logs_source" RENAME TO "idx_audit_logs_source";
ALTER INDEX "audit_logs_user_id" RENAME TO "idx_audit_logs_user_id";
ALTER INDEX "avatar_themes_is_active" RENAME TO "idx_avatar_themes_is_active";
ALTER TABLE "avatar_themes" RENAME CONSTRAINT "avatar_themes_name_key" TO "uq_avatar_themes_name";
ALTER TABLE "avatar_themes" RENAME CONSTRAINT "avatar_themes_pkey" TO "pk_avatar_themes";
ALTER INDEX "avatars_avatar_theme_id" RENAME TO "idx_avatars_avatar_theme_id";
ALTER TABLE "avatars" RENAME CONSTRAINT "avatars_avatar_theme_id_fkey" TO "fk_avatars_avatar_theme_id";
ALTER INDEX "avatars_is_active" RENAME TO "idx_avatars_is_active";
ALTER TABLE "avatars" RENAME CONSTRAINT "avatars_pkey" TO "pk_avatars";
ALTER TABLE "biometric_challenges" RENAME CONSTRAINT "biometric_challenges_challenge_key" TO "uq_biometric_challenges_challenge";
ALTER TABLE "biometric_challenges" RENAME CONSTRAINT "biometric_challenges_pkey" TO "pk_biometric_challenges";
ALTER TABLE "biometric_challenges" RENAME CONSTRAINT "biometric_challenges_user_id_fkey" TO "fk_biometric_challenges_user_id";
ALTER INDEX "cities_department_id" RENAME TO "idx_cities_department_id";
ALTER TABLE "cities" RENAME CONSTRAINT "cities_department_id_fkey" TO "fk_cities_department_id";
ALTER INDEX "cities_department_id_name" RENAME TO "idx_cities_department_id_name";
ALTER INDEX "cities_is_active" RENAME TO "idx_cities_is_active";
ALTER INDEX "cities_name" RENAME TO "idx_cities_name";
ALTER TABLE "cities" RENAME CONSTRAINT "cities_pkey" TO "pk_cities";
ALTER TABLE "consent_types" RENAME CONSTRAINT "consent_types_code_key" TO "uq_consent_types_code";
ALTER INDEX "consent_types_is_active_idx" RENAME TO "idx_consent_types_is_active";
ALTER TABLE "consent_types" RENAME CONSTRAINT "consent_types_pkey" TO "pk_consent_types";
ALTER TABLE "consent_types" RENAME CONSTRAINT "consent_types_scope_check" TO "ck_consent_types_scope";
ALTER TABLE "countries" RENAME CONSTRAINT "countries_code_key" TO "uq_countries_code";
ALTER INDEX "countries_is_active" RENAME TO "idx_countries_is_active";
ALTER TABLE "countries" RENAME CONSTRAINT "countries_name_key" TO "uq_countries_name";
ALTER TABLE "countries" RENAME CONSTRAINT "countries_pkey" TO "pk_countries";
ALTER INDEX "departments_country_id" RENAME TO "idx_departments_country_id";
ALTER TABLE "departments" RENAME CONSTRAINT "departments_country_id_fkey" TO "fk_departments_country_id";
ALTER INDEX "departments_country_id_name" RENAME TO "idx_departments_country_id_name";
ALTER INDEX "departments_is_active" RENAME TO "idx_departments_is_active";
ALTER INDEX "departments_name" RENAME TO "idx_departments_name";
ALTER TABLE "departments" RENAME CONSTRAINT "departments_pkey" TO "pk_departments";
ALTER TABLE "document_types" RENAME CONSTRAINT "document_types_code_key" TO "uq_document_types_code";
ALTER INDEX "document_types_is_active" RENAME TO "idx_document_types_is_active";
ALTER INDEX "document_types_is_visible_to_client" RENAME TO "idx_document_types_is_visible_to_client";
ALTER TABLE "document_types" RENAME CONSTRAINT "document_types_pkey" TO "pk_document_types";
ALTER TABLE "email_bounce_suppressions" RENAME CONSTRAINT "email_bounce_suppressions_email_hash_key" TO "uq_email_bounce_suppressions_email_hash";
ALTER INDEX "email_bounce_suppressions_last_bounce_at" RENAME TO "idx_email_bounce_suppressions_last_bounce_at";
ALTER TABLE "email_bounce_suppressions" RENAME CONSTRAINT "email_bounce_suppressions_pkey" TO "pk_email_bounce_suppressions";
ALTER INDEX "email_bounce_suppressions_status" RENAME TO "idx_email_bounce_suppressions_status";
ALTER TABLE "email_bounce_suppressions" RENAME CONSTRAINT "email_bounce_suppressions_user_id_fkey" TO "fk_email_bounce_suppressions_user_id";
ALTER INDEX "genders_is_active" RENAME TO "idx_genders_is_active";
ALTER TABLE "genders" RENAME CONSTRAINT "genders_name_key" TO "uq_genders_name";
ALTER TABLE "genders" RENAME CONSTRAINT "genders_pkey" TO "pk_genders";
ALTER INDEX "global_notification_reads_global_notification_id" RENAME TO "idx_global_notification_reads_global_notification_id";
ALTER TABLE "global_notification_reads" RENAME CONSTRAINT "global_notification_reads_global_notification_id_fkey" TO "fk_global_notification_reads_global_notification_id";
ALTER TABLE "global_notification_reads" RENAME CONSTRAINT "global_notification_reads_pkey" TO "pk_global_notification_reads";
ALTER INDEX "global_notification_reads_read_at" RENAME TO "idx_global_notification_reads_read_at";
ALTER INDEX "global_notification_reads_user_id" RENAME TO "idx_global_notification_reads_user_id";
ALTER TABLE "global_notification_reads" RENAME CONSTRAINT "global_notification_reads_user_id_fkey" TO "fk_global_notification_reads_user_id";
ALTER INDEX "global_notifications_created_by" RENAME TO "idx_global_notifications_created_by";
ALTER TABLE "global_notifications" RENAME CONSTRAINT "global_notifications_created_by_fkey" TO "fk_global_notifications_created_by";
ALTER INDEX "global_notifications_email_processing_status" RENAME TO "idx_global_notifications_email_processing_status";
ALTER INDEX "global_notifications_is_active_starts_at_ends_at" RENAME TO "idx_global_notifications_is_active_starts_at_ends_at";
ALTER INDEX "global_notifications_notification_type_id" RENAME TO "idx_global_notifications_notification_type_id";
ALTER TABLE "global_notifications" RENAME CONSTRAINT "global_notifications_notification_type_id_fkey" TO "fk_global_notifications_notification_type_id";
ALTER TABLE "global_notifications" RENAME CONSTRAINT "global_notifications_pkey" TO "pk_global_notifications";
ALTER INDEX "global_notifications_push_processing_status" RENAME TO "idx_global_notifications_push_processing_status";
ALTER INDEX "integration_api_logs_created_at" RENAME TO "idx_integration_api_logs_created_at";
ALTER INDEX "integration_api_logs_notification_id" RENAME TO "idx_integration_api_logs_notification_id";
ALTER TABLE "integration_api_logs" RENAME CONSTRAINT "integration_api_logs_pkey" TO "pk_integration_api_logs";
ALTER INDEX "integration_api_logs_product" RENAME TO "idx_integration_api_logs_product";
ALTER INDEX "integration_api_logs_product_result_created_at" RENAME TO "idx_integration_api_logs_product_result_created_at";
ALTER INDEX "integration_api_logs_result" RENAME TO "idx_integration_api_logs_result";
ALTER INDEX "integration_api_logs_session_id" RENAME TO "idx_integration_api_logs_session_id";
ALTER INDEX "integration_api_logs_user_id" RENAME TO "idx_integration_api_logs_user_id";
ALTER TABLE "notification_categories" RENAME CONSTRAINT "notification_categories_code_key" TO "uq_notification_categories_code";
ALTER TABLE "notification_categories" RENAME CONSTRAINT "notification_categories_pkey" TO "pk_notification_categories";
ALTER TABLE "notification_types" RENAME CONSTRAINT "notification_types_code_key" TO "uq_notification_types_code";
ALTER INDEX "notification_types_is_active" RENAME TO "idx_notification_types_is_active";
ALTER TABLE "notification_types" RENAME CONSTRAINT "notification_types_notification_category_id_fkey" TO "fk_notification_types_notification_category_id";
ALTER TABLE "notification_types" RENAME CONSTRAINT "notification_types_pkey" TO "pk_notification_types";
ALTER INDEX "notification_types_priority" RENAME TO "idx_notification_types_priority";
ALTER INDEX "notifications_email_next_retry_at" RENAME TO "idx_notifications_email_next_retry_at";
ALTER INDEX "notifications_notification_type_id" RENAME TO "idx_notifications_notification_type_id";
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_notification_type_id_fkey" TO "fk_notifications_notification_type_id";
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_pkey" TO "pk_notifications";
ALTER INDEX "notifications_push_next_retry_at" RENAME TO "idx_notifications_push_next_retry_at";
ALTER INDEX "notifications_related_entity_type_related_entity_id" RENAME TO "idx_notifications_related_entity_type_related_entity_id";
ALTER INDEX "notifications_user_id" RENAME TO "idx_notifications_user_id";
ALTER INDEX "notifications_user_id_created_at" RENAME TO "idx_notifications_user_id_created_at";
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_user_id_fkey" TO "fk_notifications_user_id";
ALTER INDEX "notifications_user_id_is_read_created_at" RENAME TO "idx_notifications_user_id_is_read_created_at";
ALTER INDEX "person_contacts_email_email_verified_at" RENAME TO "idx_person_contacts_email_email_verified_at";
ALTER TABLE "person_contacts" RENAME CONSTRAINT "person_contacts_email_hash_key" TO "uq_person_contacts_email_hash";
ALTER TABLE "person_contacts" RENAME CONSTRAINT "person_contacts_email_key" TO "uq_person_contacts_email";
ALTER INDEX "person_contacts_email_verified_at" RENAME TO "idx_person_contacts_email_verified_at";
ALTER TABLE "person_contacts" RENAME CONSTRAINT "person_contacts_person_id_fkey" TO "fk_person_contacts_person_id";
ALTER TABLE "person_contacts" RENAME CONSTRAINT "person_contacts_person_id_key" TO "uq_person_contacts_person_id";
ALTER INDEX "person_contacts_phone_primary" RENAME TO "idx_person_contacts_phone_primary";
ALTER TABLE "person_contacts" RENAME CONSTRAINT "person_contacts_phone_primary_prefix_id_fkey" TO "fk_person_contacts_phone_primary_prefix_id";
ALTER INDEX "person_contacts_phone_primary_verified_at" RENAME TO "idx_person_contacts_phone_primary_verified_at";
ALTER INDEX "person_contacts_phone_secondary" RENAME TO "idx_person_contacts_phone_secondary";
ALTER TABLE "person_contacts" RENAME CONSTRAINT "person_contacts_phone_secondary_prefix_id_fkey" TO "fk_person_contacts_phone_secondary_prefix_id";
ALTER TABLE "person_contacts" RENAME CONSTRAINT "person_contacts_pkey" TO "pk_person_contacts";
ALTER INDEX "person_locations_city_id" RENAME TO "idx_person_locations_city_id";
ALTER INDEX "person_locations_country_id" RENAME TO "idx_person_locations_country_id";
ALTER TABLE "person_locations" RENAME CONSTRAINT "person_locations_country_id_fkey" TO "fk_person_locations_country_id";
ALTER INDEX "person_locations_department_id" RENAME TO "idx_person_locations_department_id";
ALTER TABLE "person_locations" RENAME CONSTRAINT "person_locations_person_id_fkey" TO "fk_person_locations_person_id";
ALTER TABLE "person_locations" RENAME CONSTRAINT "person_locations_person_id_key" TO "uq_person_locations_person_id";
ALTER TABLE "person_locations" RENAME CONSTRAINT "person_locations_pkey" TO "pk_person_locations";
ALTER TABLE "person_references" RENAME CONSTRAINT "person_references_person_id_fkey" TO "fk_person_references_person_id";
ALTER TABLE "person_references" RENAME CONSTRAINT "person_references_pkey" TO "pk_person_references";
ALTER INDEX "persons_country_id" RENAME TO "idx_persons_country_id";
ALTER TABLE "persons" RENAME CONSTRAINT "persons_country_id_fkey" TO "fk_persons_country_id";
ALTER INDEX "persons_document_type_id" RENAME TO "idx_persons_document_type_id";
ALTER TABLE "persons" RENAME CONSTRAINT "persons_document_type_id_fkey" TO "fk_persons_document_type_id";
ALTER INDEX "persons_first_name_last_name" RENAME TO "idx_persons_first_name_last_name";
ALTER INDEX "persons_gender_id" RENAME TO "idx_persons_gender_id";
ALTER TABLE "persons" RENAME CONSTRAINT "persons_gender_id_fkey" TO "fk_persons_gender_id";
ALTER TABLE "persons" RENAME CONSTRAINT "persons_national_id_hash_key" TO "uq_persons_national_id_hash";
ALTER TABLE "persons" RENAME CONSTRAINT "persons_national_id_key" TO "uq_persons_national_id";
ALTER TABLE "persons" RENAME CONSTRAINT "persons_pkey" TO "pk_persons";
ALTER INDEX "phone_prefixes_country_id" RENAME TO "idx_phone_prefixes_country_id";
ALTER TABLE "phone_prefixes" RENAME CONSTRAINT "phone_prefixes_country_id_fkey" TO "fk_phone_prefixes_country_id";
ALTER INDEX "phone_prefixes_is_active" RENAME TO "idx_phone_prefixes_is_active";
ALTER TABLE "phone_prefixes" RENAME CONSTRAINT "phone_prefixes_pkey" TO "pk_phone_prefixes";
ALTER INDEX "phone_prefixes_prefix" RENAME TO "idx_phone_prefixes_prefix";
ALTER INDEX "privacy_policies_is_active_idx" RENAME TO "idx_privacy_policies_is_active";
ALTER TABLE "privacy_policies" RENAME CONSTRAINT "privacy_policies_pkey" TO "pk_privacy_policies";
ALTER TABLE "privacy_policies" RENAME CONSTRAINT "privacy_policies_version_key" TO "uq_privacy_policies_version";
ALTER INDEX "provider_fallback_events_circuit_product" RENAME TO "idx_provider_fallback_events_circuit_product";
ALTER INDEX "provider_fallback_events_ended_at" RENAME TO "idx_provider_fallback_events_ended_at";
ALTER TABLE "provider_fallback_events" RENAME CONSTRAINT "provider_fallback_events_pkey" TO "pk_provider_fallback_events";
ALTER INDEX "provider_fallback_events_provider" RENAME TO "idx_provider_fallback_events_provider";
ALTER INDEX "provider_fallback_events_provider_ended_at" RENAME TO "idx_provider_fallback_events_provider_ended_at";
ALTER INDEX "provider_fallback_events_started_at" RENAME TO "idx_provider_fallback_events_started_at";
ALTER TABLE "reset_credentials" RENAME CONSTRAINT "reset_credentials_pkey" TO "pk_reset_credentials";
ALTER TABLE "reset_credentials" RENAME CONSTRAINT "reset_credentials_token_key" TO "uq_reset_credentials_token";
ALTER TABLE "reset_credentials" RENAME CONSTRAINT "reset_credentials_user_id_fkey" TO "fk_reset_credentials_user_id";
ALTER TABLE "role_permission_overrides" RENAME CONSTRAINT "role_permission_overrides_granted_by_user_id_fkey" TO "fk_role_permission_overrides_granted_by_user_id";
ALTER TABLE "role_permission_overrides" RENAME CONSTRAINT "role_permission_overrides_pkey" TO "pk_role_permission_overrides";
ALTER INDEX "roles_is_active" RENAME TO "idx_roles_is_active";
ALTER TABLE "roles" RENAME CONSTRAINT "roles_name_key" TO "uq_roles_name";
ALTER TABLE "roles" RENAME CONSTRAINT "roles_pkey" TO "pk_roles";
ALTER INDEX "sms_delivery_attempts_created_at" RENAME TO "idx_sms_delivery_attempts_created_at";
ALTER INDEX "sms_delivery_attempts_phone_hash" RENAME TO "idx_sms_delivery_attempts_phone_hash";
ALTER TABLE "sms_delivery_attempts" RENAME CONSTRAINT "sms_delivery_attempts_pkey" TO "pk_sms_delivery_attempts";
ALTER INDEX "sms_delivery_attempts_status" RENAME TO "idx_sms_delivery_attempts_status";
ALTER INDEX "sms_delivery_attempts_user_id" RENAME TO "idx_sms_delivery_attempts_user_id";
ALTER TABLE "sms_delivery_attempts" RENAME CONSTRAINT "sms_delivery_attempts_user_id_fkey" TO "fk_sms_delivery_attempts_user_id";
ALTER INDEX "system_global_config_config_version" RENAME TO "idx_system_global_config_config_version";
ALTER INDEX "system_global_config_created_at" RENAME TO "idx_system_global_config_created_at";
ALTER TABLE "system_global_config" RENAME CONSTRAINT "system_global_config_pkey" TO "pk_system_global_config";
ALTER TABLE "system_global_config" RENAME CONSTRAINT "system_global_config_unique_active" TO "uq_system_global_config_is_active";
ALTER INDEX "idx_biometric_credentials_device_id" RENAME TO "idx_user_biometric_credentials_user_trusted_device_id";
ALTER INDEX "idx_biometric_credentials_user_id" RENAME TO "idx_user_biometric_credentials_user_id";
ALTER TABLE "user_biometric_credentials" RENAME CONSTRAINT "user_biometric_credentials_credential_id_key" TO "uq_user_biometric_credentials_credential_id";
ALTER TABLE "user_biometric_credentials" RENAME CONSTRAINT "user_biometric_credentials_pkey" TO "pk_user_biometric_credentials";
ALTER TABLE "user_biometric_credentials" RENAME CONSTRAINT "user_biometric_credentials_user_id_fkey" TO "fk_user_biometric_credentials_user_id";
ALTER TABLE "user_biometric_credentials" RENAME CONSTRAINT "user_biometric_credentials_user_trusted_device_id_fkey" TO "fk_user_biometric_credentials_user_trusted_device_id";
ALTER TABLE "user_change_logs" RENAME CONSTRAINT "user_change_logs_changed_by_user_id_fkey" TO "fk_user_change_logs_changed_by_user_id";
ALTER TABLE "user_change_logs" RENAME CONSTRAINT "user_change_logs_pkey" TO "pk_user_change_logs";
ALTER TABLE "user_change_logs" RENAME CONSTRAINT "user_change_logs_user_id_fkey" TO "fk_user_change_logs_user_id";
ALTER TABLE "user_consents" RENAME CONSTRAINT "user_consents_consent_type_id_fkey" TO "fk_user_consents_consent_type_id";
ALTER INDEX "user_consents_granted_at_idx" RENAME TO "idx_user_consents_granted_at";
ALTER INDEX "user_consents_is_current_idx" RENAME TO "idx_user_consents_is_current";
ALTER TABLE "user_consents" RENAME CONSTRAINT "user_consents_pkey" TO "pk_user_consents";
ALTER TABLE "user_consents" RENAME CONSTRAINT "user_consents_privacy_policy_id_fkey" TO "fk_user_consents_privacy_policy_id";
ALTER TABLE "user_consents" RENAME CONSTRAINT "user_consents_user_id_fkey" TO "fk_user_consents_user_id";
ALTER INDEX "user_consents_user_id_idx" RENAME TO "idx_user_consents_user_id";
ALTER INDEX "user_consents_user_type_idx" RENAME TO "idx_user_consents_user_id_consent_type_id";
ALTER INDEX "user_login_attempts_attempted_at" RENAME TO "idx_user_login_attempts_attempted_at";
ALTER INDEX "user_login_attempts_blocked_until" RENAME TO "idx_user_login_attempts_blocked_until";
ALTER INDEX "user_login_attempts_ip_address" RENAME TO "idx_user_login_attempts_ip_address";
ALTER INDEX "user_login_attempts_ip_address_attempted_at" RENAME TO "idx_user_login_attempts_ip_address_attempted_at";
ALTER TABLE "user_login_attempts" RENAME CONSTRAINT "user_login_attempts_pkey" TO "pk_user_login_attempts";
ALTER INDEX "user_login_attempts_success" RENAME TO "idx_user_login_attempts_success";
ALTER INDEX "user_login_attempts_user_id" RENAME TO "idx_user_login_attempts_user_id";
ALTER INDEX "user_login_attempts_user_id_attempted_at_success" RENAME TO "idx_user_login_attempts_user_id_attempted_at_success";
ALTER TABLE "user_login_attempts" RENAME CONSTRAINT "user_login_attempts_user_id_fkey" TO "fk_user_login_attempts_user_id";
ALTER INDEX "user_login_attempts_username_attempt" RENAME TO "idx_user_login_attempts_username_attempt";
ALTER INDEX "idx_unp_notification_category_code" RENAME TO "idx_user_notification_preferences_notification_category_code";
ALTER INDEX "idx_unp_user_id_notification_category_code" RENAME TO "uq_user_notif_prefs_user_id_notification_category_code";
ALTER TABLE "user_notification_preferences" RENAME CONSTRAINT "user_notification_preferences_pkey" TO "pk_user_notification_preferences";
ALTER INDEX "user_notification_preferences_user_id" RENAME TO "idx_user_notification_preferences_user_id";
ALTER TABLE "user_notification_preferences" RENAME CONSTRAINT "user_notification_preferences_user_id_fkey" TO "fk_user_notification_preferences_user_id";
ALTER INDEX "user_push_tokens_is_active" RENAME TO "idx_user_push_tokens_is_active";
ALTER TABLE "user_push_tokens" RENAME CONSTRAINT "user_push_tokens_pkey" TO "pk_user_push_tokens";
ALTER INDEX "user_push_tokens_platform" RENAME TO "idx_user_push_tokens_platform";
ALTER INDEX "user_push_tokens_user_id" RENAME TO "idx_user_push_tokens_user_id";
ALTER TABLE "user_push_tokens" RENAME CONSTRAINT "user_push_tokens_user_id_fkey" TO "fk_user_push_tokens_user_id";
ALTER INDEX "user_push_tokens_user_id_is_active" RENAME TO "idx_user_push_tokens_user_id_is_active";
ALTER INDEX "user_push_tokens_user_id_token" RENAME TO "uq_user_push_tokens_user_id_token";
ALTER INDEX "user_sessions_device_id" RENAME TO "idx_user_sessions_device_id";
ALTER TABLE "user_sessions" RENAME CONSTRAINT "user_sessions_device_id_fkey" TO "fk_user_sessions_device_id";
ALTER TABLE "user_sessions" RENAME CONSTRAINT "user_sessions_jti_key" TO "uq_user_sessions_jti";
ALTER TABLE "user_sessions" RENAME CONSTRAINT "user_sessions_pkey" TO "pk_user_sessions";
ALTER INDEX "user_sessions_started_at" RENAME TO "idx_user_sessions_started_at";
ALTER INDEX "user_sessions_status" RENAME TO "idx_user_sessions_status";
ALTER INDEX "user_sessions_user_id" RENAME TO "idx_user_sessions_user_id";
ALTER TABLE "user_trusted_devices" RENAME CONSTRAINT "user_trusted_devices_approved_by_device_id_fkey" TO "fk_user_trusted_devices_approved_by_device_id";
ALTER TABLE "user_trusted_devices" RENAME CONSTRAINT "user_trusted_devices_blocked_by_device_id_fkey" TO "fk_user_trusted_devices_blocked_by_device_id";
ALTER TABLE "user_trusted_devices" RENAME CONSTRAINT "user_trusted_devices_pkey" TO "pk_user_trusted_devices";
ALTER TABLE "user_trusted_devices" RENAME CONSTRAINT "user_trusted_devices_user_id_fkey" TO "fk_user_trusted_devices_user_id";
ALTER TABLE "users" RENAME CONSTRAINT "users_avatar_id_fkey" TO "fk_users_avatar_id";
ALTER TABLE "users" RENAME CONSTRAINT "users_cognito_username_key" TO "uq_users_auth_username";
ALTER INDEX "users_is_active" RENAME TO "idx_users_is_active";
ALTER TABLE "users" RENAME CONSTRAINT "users_person_id_fkey" TO "fk_users_person_id";
ALTER TABLE "users" RENAME CONSTRAINT "users_person_id_key" TO "uq_users_person_id";
ALTER TABLE "users" RENAME CONSTRAINT "users_pkey" TO "pk_users";
ALTER INDEX "users_privacy_policy_version_idx" RENAME TO "idx_users_privacy_policy_version";
ALTER INDEX "users_role_id" RENAME TO "idx_users_role_id";
ALTER TABLE "users" RENAME CONSTRAINT "users_role_id_fkey" TO "fk_users_role_id";
ALTER TABLE "users" RENAME CONSTRAINT "users_username_key" TO "uq_users_username";
ALTER INDEX "verification_codes_contact_value" RENAME TO "idx_verification_codes_contact_value";
ALTER INDEX "verification_codes_contact_value_type_expires_at" RENAME TO "idx_verification_codes_contact_value_type_expires_at";
ALTER INDEX "verification_codes_expires_at" RENAME TO "idx_verification_codes_expires_at";
ALTER TABLE "verification_codes" RENAME CONSTRAINT "verification_codes_pkey" TO "pk_verification_codes";
ALTER INDEX "verification_codes_type" RENAME TO "idx_verification_codes_type";
ALTER INDEX "verification_codes_verified_at" RENAME TO "idx_verification_codes_verified_at";
