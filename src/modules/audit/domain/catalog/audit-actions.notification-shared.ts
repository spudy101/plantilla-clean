// ================================================================
// NOTIFICATION — SHARED ENDPOINTS
// Ruta:     modules/shared-endpoints/notification/
// Módulo:   client  (acciones disparadas por el usuario autenticado)
//           system  (creación vía X-API-Key externa)
// Services: notification, notification-preference
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  // ── LISTADOS DE NOTIFICACIONES ────────────────────────────────────────────
  NOTIFICATION_LIST_VIEWED: {
    description: 'Usuario consultó su bandeja mixta de notificaciones (personal + global)',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },

  NOTIFICATION_PERSONAL_LIST_VIEWED: {
    description: 'Usuario consultó sus notificaciones personales',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },

  NOTIFICATION_GLOBAL_LIST_VIEWED: {
    description: 'Usuario consultó las notificaciones globales',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },

  NOTIFICATION_UNREAD_COUNT_VIEWED: {
    description: 'Usuario consultó el conteo de notificaciones no leídas',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },

  // ── CREACIÓN EXTERNA (X-API-Key) ──────────────────────────────────────────
  NOTIFICATION_CREATED: {
    description: 'Notificación creada por servicio externo vía API Key',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.LOW
  },

  NOTIFICATION_DIRECT_CREATED: {
    description: 'Notificación directa (sin BD) creada por servicio externo vía API Key',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.LOW
  },

  // ── PREFERENCIAS DE NOTIFICACIÓN ─────────────────────────────────────────
  NOTIFICATION_PREFERENCES_VIEWED: {
    description: 'Usuario consultó sus preferencias de notificación',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },

  NOTIFICATION_GLOBAL_PREFERENCE_UPDATED: {
    description: 'Usuario actualizó su preferencia de notificaciones (push, email, SMS, horario de silencio)',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  }
};
