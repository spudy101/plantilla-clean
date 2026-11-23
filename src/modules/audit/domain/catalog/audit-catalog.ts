// ================================================================
// AUDIT CATALOG — Fuente de verdad de la taxonomía de auditoría.
//
// Catálogo canónico de las dimensiones con las que se clasifica cada
// acción de auditoría (`AUDIT_ACTIONS`): categoría, nivel de riesgo y
// módulo. Toda acción DEBE usar valores de este catálogo (homologación
// garantizada por el test de consistencia audit-catalog.consistency).
//
// La API de catálogo (`/api/audit-action-catalog/*`) lee de aquí, por lo
// que el front siempre recibe el mismo conjunto homologado que clasifica
// los logs en `audit_logs`.
//
// ⚠️ Al agregar una categoría nueva: agregarla aquí PRIMERO y luego usarla
//    en las acciones. Nunca escribir un literal suelto.
// ================================================================

// ── CATEGORÍAS (dominio funcional de la acción) ──────────────────
const AUDIT_CATEGORIES = {
  KYC: 'KYC',
  AUTH: 'Autenticación',
  INTEGRATIONS: 'Integraciones',
  AUDIT: 'Auditoría',
  NOTIFICATIONS: 'Notificaciones',
  PERSONS: 'Personas',
  CATALOGS: 'Catálogos',
  PROFILE: 'Perfil',
  BIOMETRIC: 'Biométrico',
  INTERNAL_USERS: 'Usuarios internos',
  PQRS: 'PQRS',
  DUAL_APPROVAL: 'Doble aprobación',
  RBAC: 'RBAC',
  ADMINISTRATION: 'Administración',
  CONSENTS: 'Consentimientos',
  PRIVACY_POLICIES: 'Políticas de privacidad',
  PROVIDER_HEALTH: 'Provider Health',
  CONFIGURATION: 'Configuración',
  CRM: 'CRM'
};

// ── NIVELES DE RIESGO (severidad; define si dispara alerta) ──────
const AUDIT_RISKS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Orden de severidad ascendente — la API expone los riesgos en este orden.
const AUDIT_RISK_ORDER = [AUDIT_RISKS.LOW, AUDIT_RISKS.MEDIUM, AUDIT_RISKS.HIGH, AUDIT_RISKS.CRITICAL];

// ── MÓDULOS (origen de la acción) ────────────────────────────────
const AUDIT_MODULES = {
  ADMIN: 'admin', // ejecutada por un administrador
  CLIENT: 'client', // ejecutada por un usuario cliente
  SYSTEM: 'system' // disparada por workers / cron / motor automático
};

// ── RESULTADO de la operación ────────────────────────────────────
// Dimensión del REGISTRO de auditoría (no clasifica la acción): cómo terminó
// esa ejecución puntual. Espeja el ENUM `outcome` de la tabla audit_logs.
const AUDIT_OUTCOMES = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  WARNING: 'warning',
  ATTEMPT: 'attempt'
};

// ── SOURCE / origen técnico del registro ─────────────────────────
// Dimensión del REGISTRO de auditoría. Espeja la columna `source` de audit_logs.
//   http    → request HTTP (audit.middleware)
//   worker  → cron/worker (runOperation({ source: 'worker' }))
//   system  → evento de infraestructura (runOperation({ source: 'system' }))
//   unknown → logAudit ejecutado fuera de todo contexto (anomalía detectable)
const AUDIT_SOURCES = {
  HTTP: 'http',
  WORKER: 'worker',
  SYSTEM: 'system',
  UNKNOWN: 'unknown'
};

export default {
  AUDIT_CATEGORIES,
  AUDIT_RISKS,
  AUDIT_RISK_ORDER,
  AUDIT_MODULES,
  AUDIT_OUTCOMES,
  AUDIT_SOURCES
};
