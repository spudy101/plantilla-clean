// ================================================================
// ENTREGA DE NOTIFICACIONES E INTEGRACIONES EXTERNAS
// Acciones que ya se registraban pero no estaban en el catálogo (salían como "Sin categoría"):
// supresión de correos y rebotes de SES, fallos de SMS, categorías de notificación y monitoreo
// de proveedores externos.
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  // ── CORREO: rebotes y supresión ───────────────────────────────
  EMAIL_BOUNCE_SUBSCRIPTION_CONFIRMED: {
    description: 'Suscripción SNS de rebotes de SES confirmada',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.MEDIUM
  },
  EMAIL_BOUNCE_WEBHOOK_RECEIVED: {
    description: 'Notificación de rebote de correo recibida desde SES',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.LOW
  },
  EMAIL_HARD_BOUNCE_RECORDED: {
    description: 'Rebote permanente de correo registrado',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.LOW
  },
  EMAIL_ADDRESS_SUPPRESSED: {
    description: 'Dirección de correo suprimida: no se le volverá a enviar',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.MEDIUM
  },
  EMAIL_SUPPRESSION_LIFTED: {
    description: 'Supresión de una dirección de correo levantada por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  EMAIL_SUPPRESSED_SEND_SKIPPED: {
    description: 'Envío de correo omitido: la dirección está suprimida',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.LOW
  },

  // ── SMS ───────────────────────────────────────────────────────
  SMS_DELIVERY_FAILED: {
    description: 'Entrega de SMS fallida',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── CATEGORÍAS DE NOTIFICACIÓN (admin) ────────────────────────
  NOTIFICATION_CATEGORY_LIST_VIEWED: {
    description: 'Listado de categorías de notificación consultado por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  NOTIFICATION_CATEGORY_VIEWED: {
    description: 'Categoría de notificación consultada por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  NOTIFICATION_CATEGORY_CREATED: {
    description: 'Categoría de notificación creada por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  NOTIFICATION_CATEGORY_UPDATED: {
    description: 'Categoría de notificación modificada por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  NOTIFICATION_CATEGORY_DELETED: {
    description: 'Categoría de notificación eliminada por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── INTEGRACIONES / PROVEEDORES ───────────────────────────────
  PROVIDER_HEALTH_DASHBOARD_VIEWED: {
    description: 'Salud de proveedores externos consultada por administrador',
    category: AUDIT_CATEGORIES.PROVIDER_HEALTH,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  PROVIDER_FALLBACK_HISTORY_VIEWED: {
    description: 'Historial de fallbacks de proveedores consultado por administrador',
    category: AUDIT_CATEGORIES.PROVIDER_HEALTH,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  PROVIDER_FALLBACK_ACTIVATED: {
    description: 'Circuit breaker abierto: proveedor externo en fallback',
    category: AUDIT_CATEGORIES.PROVIDER_HEALTH,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.HIGH
  },
  PROVIDER_FALLBACK_RESOLVED: {
    description: 'Circuit breaker cerrado: proveedor externo recuperado',
    category: AUDIT_CATEGORIES.PROVIDER_HEALTH,
    module: AUDIT_MODULES.SYSTEM,
    risk: AUDIT_RISKS.MEDIUM
  }
};
