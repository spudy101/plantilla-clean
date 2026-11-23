// ================================================================
// KYC — ADMIN
// Módulo: modules/admin/kyc/
// Services: admin-person, admin-notification-type, privacy-policy-admin
//
// Nota: las acciones de admin-change-log y admin-auth-session se movieron
// a audit-actions.audit-admin.js (módulo modules/admin/audit/).
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  // ── PERSONAS ──────────────────────────────────────────────────

  PERSON_LIST_VIEWED: {
    description: 'Listado de usuarios consultado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  PERSON_DELETED_LIST_VIEWED: {
    description: 'Listado histórico de clientes eliminados consultado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  PERSON_ROLE_OPTIONS_VIEWED: {
    description: 'Catálogo de roles de cliente (para filtro de listado) consultado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  PERSON_VIEWED: {
    description: 'Perfil completo de usuario consultado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  PERSON_CREATED: {
    description: 'Nuevo usuario creado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  PERSON_ACTIVATED: {
    description: 'Cuenta de usuario activada por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  PERSON_DEACTIVATED: {
    description: 'Cuenta de usuario desactivada por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  PERSON_PASSWORD_RESET: {
    description: 'Contraseña de usuario reseteada por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.CRITICAL
  },
  PERSON_MFA_DISABLED: {
    alert: true,
    description: 'MFA/TOTP de usuario deshabilitado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.CRITICAL
  },
  PERSON_EMAIL_CHANGED: {
    description: 'Email de usuario modificado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.CRITICAL
  },
  PERSON_NATIONAL_ID_CHANGED: {
    alert: true,
    description: 'Número de identificación de usuario modificado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.CRITICAL
  },
  PERSON_ROLE_CHANGED: {
    description: 'Rol de usuario modificado por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  PERSON_ACCOUNT_DELETED: {
    alert: true,
    description: 'Cuenta de usuario eliminada permanentemente por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.CRITICAL
  },

  PROFILE_COMPLETENESS_VIEWED_ADMIN: {
    description: 'Completitud de perfil de usuario consultada por administrador',
    category: AUDIT_CATEGORIES.PERSONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },

  // ── TIPOS DE CONSENTIMIENTO ───────────────────────────────────

  CONSENT_TYPE_LIST_VIEWED: {
    description: 'Listado de tipos de consentimiento consultado por administrador',
    category: AUDIT_CATEGORIES.CONSENTS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  CONSENT_TYPE_DETAIL_VIEWED: {
    description: 'Detalle de tipo de consentimiento consultado por administrador',
    category: AUDIT_CATEGORIES.CONSENTS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  CONSENT_TYPE_CREATED: {
    description: 'Nuevo tipo de consentimiento creado por administrador',
    category: AUDIT_CATEGORIES.CONSENTS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  CONSENT_TYPE_UPDATED: {
    description: 'Tipo de consentimiento actualizado por administrador',
    category: AUDIT_CATEGORIES.CONSENTS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── TIPOS DE NOTIFICACIÓN ─────────────────────────────────────

  NOTIFICATION_TYPE_LIST_VIEWED: {
    description: 'Listado de tipos de notificación consultado por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  NOTIFICATION_TYPE_UPDATED: {
    alert: true,
    description: 'Template de tipo de notificación actualizado por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  GLOBAL_NOTIFICATION_SENT: {
    alert: true,
    description: 'Notificación global enviada a todos los usuarios por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },
  DIRECT_NOTIFICATION_SENT: {
    description: 'Notificación directa enviada a un usuario específico por administrador',
    category: AUDIT_CATEGORIES.NOTIFICATIONS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── POLÍTICA DE PRIVACIDAD ────────────────────────────────────

  PRIVACY_POLICY_LIST_VIEWED: {
    description: 'Listado de versiones de política de privacidad consultado por administrador',
    category: AUDIT_CATEGORIES.PRIVACY_POLICIES,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  PRIVACY_POLICY_DETAIL_VIEWED: {
    description: 'Detalle de versión de política de privacidad consultado por administrador',
    category: AUDIT_CATEGORIES.PRIVACY_POLICIES,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  PRIVACY_POLICY_VERSION_CREATED: {
    alert: true,
    description: 'Nueva versión de política de privacidad publicada y activada por administrador',
    category: AUDIT_CATEGORIES.PRIVACY_POLICIES,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.HIGH
  },

  // ── PQRS / CONTACTO ───────────────────────────────────────────

  CONTACT_INQUIRY_LIST_VIEWED: {
    description: 'Listado de solicitudes de contacto (PQRS) consultado por administrador',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_DETAIL_VIEWED: {
    description: 'Detalle de solicitud de contacto (PQRS) consultado por administrador',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_ESTADO_UPDATED: {
    description: 'Estado de solicitud de contacto (PQRS) actualizado por administrador',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  CONTACT_INQUIRY_ASSIGNED: {
    description: 'Solicitud de contacto (PQRS) tomada por un asesor',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_REASSIGNED: {
    description: 'Solicitud de contacto (PQRS) reasignada a otro asesor por un administrador',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  },
  CONTACT_INQUIRY_RESPONDED: {
    description: 'Respuesta oficial enviada al remitente de una solicitud de contacto (PQRS)',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.ADMIN,
    risk: AUDIT_RISKS.MEDIUM
  }
};
