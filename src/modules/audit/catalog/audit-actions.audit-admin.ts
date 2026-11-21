// ================================================================
// AUDIT — ADMIN (Consulta de logs y gestión de alertas de auditoría)
// Módulo: modules/admin/audit/
// Services: admin-audit-log, admin-audit-alert
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS } = auditCatalogModule;

export default {
  // ── LOGS DE AUDITORÍA ─────────────────────────────────────────

  AUDIT_LOG_LISTED: {
    description: 'Listado de logs de auditoría consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  AUDIT_LOG_VIEWED: {
    description: 'Detalle de log de auditoría consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  AUDIT_LOG_EXPORTED: {
    alert: true,
    description: 'Logs de auditoría exportados por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.HIGH
  },

  // ── ALERTAS DE AUDITORÍA ──────────────────────────────────────

  AUDIT_ALERT_LISTED: {
    description: 'Alertas de auditoría consultadas por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.LOW
  },
  AUDIT_ALERT_ACKNOWLEDGED: {
    description: 'Alerta de auditoría reconocida por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  AUDIT_ALERTS_BULK_ACKNOWLEDGED: {
    description: 'Múltiples alertas de auditoría reconocidas en bloque por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── SESIONES Y ACCESOS ────────────────────────────────────────

  AUTH_SESSION_LIST_VIEWED: {
    description: 'Listado de sesiones activas consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  AUTH_SESSION_BY_USER_VIEWED: {
    description: 'Sesiones de un usuario consultadas por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  AUTH_SESSION_REVOKED: {
    description: 'Sesión activa revocada por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.HIGH
  },
  AUTH_ATTEMPTS_LIST_VIEWED: {
    description: 'Listado de intentos de autenticación consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  AUTH_ATTEMPTS_BY_USER_VIEWED: {
    description: 'Intentos de autenticación de un usuario consultados por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── TRAZA FORENSE DE SESIÓN (Fase 5 — API admin de sesiones) ──

  SESSION_TRACE_LIST_VIEWED: {
    description: 'Listado forense de sesiones consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  SESSION_TRACE_VIEWED: {
    description: 'Traza (timeline) de una sesión consultada por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  SESSION_TRACE_ENTITIES_VIEWED: {
    description: 'Filas de dominio de una sesión hidratadas por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── TRAZA DE OPERACIONES ──────────────────────────────────────

  OPERATION_LIST_VIEWED: {
    description: 'Listado de operaciones (HTTP, webhooks, workers, sistema) consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  OPERATION_VIEWED: {
    description: 'Línea de tiempo de una operación consultada por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── BINDING DOSSIER ───────────────────────────────────────────

  BINDING_DOSSIER_LIST_VIEWED: {
    description: 'Listado de expedientes de vinculación consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  BINDING_DOSSIER_VIEWED: {
    description: 'Detalle de expediente de vinculación consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  // §6.3: regeneración de un expediente faltante (remediación del sellado). Idempotente.
  BINDING_DOSSIER_REGENERATED: {
    description: 'Expediente de vinculación regenerado por administrador (remediación de sellado faltante)',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.HIGH
  },
  // ── CONSENTIMIENTOS ───────────────────────────────────────────

  CONSENT_LIST_VIEWED: {
    description: 'Listado de consentimientos de usuario consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },
  CONSENT_HISTORY_VIEWED: {
    description: 'Historial de consentimientos de un usuario consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── CHANGE LOGS ───────────────────────────────────────────────

  CHANGE_LOG_VIEWED: {
    description: 'Logs de cambios de datos consultados por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── ENTREGAS DE NOTIFICACIONES ────────────────────────────────

  NOTIFICATION_DELIVERY_LIST_VIEWED: {
    description: 'Listado de entregas de notificaciones consultado por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    risk: AUDIT_RISKS.LOW
  },
  NOTIFICATION_DELIVERY_VIEWED: {
    description: 'Detalle de entrega de notificación consultado por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    risk: AUDIT_RISKS.LOW
  },
  EMAIL_DELIVERY_FAILED: {
    description: 'Entrega de email fallida: rebote definitivo o reintentos agotados (SES)',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    risk: AUDIT_RISKS.MEDIUM
  },
  PUSH_DELIVERY_FAILED: {
    description: 'Entrega de push fallida: rebote definitivo o reintentos agotados (SNS)',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    risk: AUDIT_RISKS.LOW
  },

  // ── CATÁLOGO DE ACCIONES DE AUDITORÍA ─────────────────────────

  AUDIT_ACTION_CATALOG_CATEGORIES_VIEWED: {
    description: 'Catálogo de categorías de auditoría consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.LOW
  },
  AUDIT_ACTION_CATALOG_RISKS_VIEWED: {
    description: 'Catálogo de niveles de riesgo de auditoría consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.LOW
  },
  AUDIT_ACTION_CATALOG_MODULES_VIEWED: {
    description: 'Catálogo de módulos de auditoría consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.LOW
  },
  AUDIT_ACTION_CATALOG_ACTIONS_LISTED: {
    description: 'Listado del catálogo de acciones de auditoría consultado por administrador',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.LOW
  }
};
