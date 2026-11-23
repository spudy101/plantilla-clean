// ================================================================
// KYC — SHARED ENDPOINTS
// Ruta:     modules/shared-endpoints/kyc/
// Módulo:   client  (RBAC_MODULES.CLIENT)
// Services: auth-login, mfa, profile, contact-inquiry, maintainers
//
// CAMBIO: se agrega campo `module` en cada acción para que logAudit
// lo registre automáticamente en audit_logs sin pasarlo en cada llamada.
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  // ── CAMBIO DE UN DATO DE LA CUENTA (bitácora de cambios) ──────
  // Un registro por campo cambiado (email, contraseña, MFA, estado, rol, documento…), con su valor
  // anterior y nuevo en details. La vista "bitácora de cambios" es un filtro sobre esta acción.
  USER_FIELD_CHANGED: {
    description: 'Dato de una cuenta modificado',
    category: AUDIT_CATEGORIES.PERSONS,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── AUTENTICACIÓN ────────────────────────────────────────────────────────
  LOGIN_SUCCESS: {
    description: 'Inicio de sesión exitoso',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  LOGIN_FAILED: {
    description: 'Intento de inicio de sesión fallido',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  LOGIN_BLOCKED_DEVICE: {
    description: 'Intento de inicio de sesión desde dispositivo bloqueado',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  LOGIN_BLOCKED_POLICY_UPDATE: {
    description: 'Inicio de sesión bloqueado — el usuario debe aceptar la nueva política de privacidad',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  ACCOUNT_BLOCKED: {
    description: 'Cuenta bloqueada por múltiples intentos fallidos',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  ACCOUNT_DELETED: {
    description: 'Cuenta de usuario eliminada del sistema',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },

  // ── MFA ──────────────────────────────────────────────────────────────────
  MFA_REQUIRED: {
    description: 'Autenticación de doble factor requerida para continuar',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  MFA_VERIFIED: {
    description: 'Verificación de doble factor completada exitosamente',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  MFA_FAILED: {
    description: 'Intento de verificación de doble factor fallido',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  MFA_PASSWORD_VALIDATED: {
    description: 'Contraseña validada como paso previo al flujo MFA',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  MFA_STATUS_VIEWED: {
    description: 'Estado de métodos MFA consultado por el usuario',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MFA_TOTP_SETUP: {
    description: 'Configuración de autenticador TOTP iniciada',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  MFA_TOTP_ACTIVATED: {
    description: 'Autenticador TOTP activado y verificado exitosamente',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  MFA_TOTP_DEACTIVATED: {
    description: 'Autenticador TOTP desactivado por el usuario',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  MFA_SMS_SETUP: {
    description: 'Configuración de SMS MFA iniciada',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  MFA_SMS_ACTIVATED: {
    description: 'SMS MFA activado y verificado exitosamente',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  MFA_SMS_DEACTIVATED: {
    description: 'SMS MFA desactivado por el usuario',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  MFA_PREFERRED_METHOD_UPDATED: {
    description: 'Método MFA preferido actualizado por el usuario',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── SESIÓN Y TOKENS ──────────────────────────────────────────────────────
  TOKEN_REFRESHED: {
    description: 'Token de acceso renovado',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  LOGOUT: {
    description: 'Cierre de sesión del dispositivo actual',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  LOGOUT_ALL: {
    description: 'Cierre de sesión en todos los dispositivos',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  LOGOUT_OTHERS: {
    description: 'Cierre de las demás sesiones, conservando la actual',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  SESSION_CLOSED_BY_USER: {
    description: 'Sesión individual cerrada por el usuario',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  SESSION_REVOKED_BY_ADMIN: {
    description: 'Sesión activa revocada por un administrador',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  SESSION_LIMIT_ENFORCED: {
    description: 'Límite de sesiones concurrentes alcanzado — sesión más antigua cerrada',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  SESSION_ABSOLUTE_EXPIRED: {
    description: 'Sesión cerrada al alcanzar el tope absoluto de vida (started_at + 8h) durante un refresh',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PREVIOUS_DEVICE_SESSIONS_CLOSED: {
    description: 'Sesiones previas del mismo dispositivo cerradas al iniciar una nueva',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  REFRESH_TOKEN_REUSE_ATTACK: {
    alert: true,
    description: 'Posible ataque de reuso de refresh token detectado — sesión comprometida',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },

  // ── DISPOSITIVOS DE CONFIANZA ────────────────────────────────────────────
  TRUSTED_DEVICES_VIEWED: {
    description: 'Consulta de dispositivos de confianza registrados',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PENDING_DEVICES_VIEWED: {
    description: 'Consulta de dispositivos pendientes de aprobación',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  TRUSTED_DEVICE_ADDED: {
    description: 'Nuevo dispositivo de confianza registrado',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  TRUSTED_DEVICE_ADDED_FIRST: {
    description: 'Primer dispositivo de confianza registrado en la cuenta',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  TRUSTED_DEVICE_PENDING: {
    description: 'Dispositivo marcado como pendiente por nuevo entorno de acceso',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  TRUSTED_DEVICE_RENAMED: {
    description: 'Dispositivo de confianza renombrado por el usuario',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  TRUSTED_DEVICE_REMOVED: {
    description: 'Dispositivo de confianza eliminado',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  TRUSTED_DEVICE_APPROVED: {
    description: 'Dispositivo pendiente aprobado como dispositivo de confianza',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  TRUSTED_DEVICE_BLOCKED: {
    description: 'Dispositivo de confianza bloqueado',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  TRUSTED_DEVICE_UNBLOCKED: {
    description: 'Dispositivo de confianza desbloqueado',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  TRUSTED_DEVICE_LIMIT_REACHED: {
    description: 'Límite de dispositivos de confianza alcanzado',
    category: AUDIT_CATEGORIES.AUTH,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },

  // ── PERFIL ───────────────────────────────────────────────────────────────
  PROFILE_VIEWED: {
    description: 'Perfil básico del usuario consultado',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PROFILE_EXTENDED_VIEWED: {
    description: 'Perfil extendido del usuario consultado (datos sensibles)',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  PROFILE_CONTACT_VIEWED: {
    description: 'Información de contacto del usuario consultada',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PROFILE_LOCATION_VIEWED: {
    description: 'Información de ubicación/residencia del usuario consultada',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PROFILE_UPDATED: {
    description: 'Datos del perfil del usuario actualizados (username, avatar, género, ubicación)',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  PROFILE_EMAIL_UPDATED: {
    description: 'Correo electrónico del usuario actualizado',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  PROFILE_PHONE_UPDATED: {
    description: 'Número de teléfono del usuario actualizado',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  PASSWORD_CHANGED: {
    description: 'Contraseña del usuario cambiada desde perfil',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  NATIONAL_ID_UPDATED: {
    description: 'Número de identificación nacional del usuario actualizado',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  PRIVACY_POLICY_VIEWED: {
    description: 'Política de privacidad consultada por el usuario',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PRIVACY_POLICY_ACCEPTED: {
    description: 'Política de privacidad aceptada por el usuario',
    category: AUDIT_CATEGORIES.PROFILE,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── CATÁLOGOS ────────────────────────────────────────────────────────────
  // Rutas públicas — auditadas para detectar scraping masivo.
  MAINTAINER_GENDERS_VIEWED: {
    description: 'Consulta de catálogo de géneros',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_PHONE_PREFIXES_VIEWED: {
    description: 'Consulta de prefijos telefónicos disponibles',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_COUNTRIES_VIEWED: {
    description: 'Consulta de catálogo de países',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_DEPARTMENTS_VIEWED: {
    description: 'Consulta de catálogo de departamentos',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_CITIES_VIEWED: {
    description: 'Consulta de catálogo de ciudades',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_ROLES_VIEWED: {
    description: 'Consulta de catálogo de roles de cliente',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_AVATARS_VIEWED: {
    description: 'Consulta de catálogo de avatares',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_AVATAR_THEMES_VIEWED: {
    description: 'Consulta de catálogo de temas de avatar',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_NOTIFICATION_TYPES_VIEWED: {
    description: 'Consulta de catálogo de tipos de notificación',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_FUNDS_ORIGIN_TYPES_VIEWED: {
    description: 'Consulta de catálogo de orígenes de fondos',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_INSTITUTIONS_VIEWED: {
    description: 'Consulta de catálogo de instituciones',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_INSTITUTION_PROGRAMS_VIEWED: {
    description: 'Consulta de programas de una institución',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_PROGRAM_CAREERS_VIEWED: {
    description: 'Consulta de carreras de un programa',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  MAINTAINER_DOCUMENT_TYPES_VIEWED: {
    description: 'Consulta del catálogo de tipos de documento',
    category: AUDIT_CATEGORIES.CATALOGS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  // ── PQRS / CONTACTO ──────────────────────────────────────────────────────
  CONTACT_INQUIRY_CREATED: {
    description: 'Solicitud de contacto (PQRS) creada',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  CONTACT_INQUIRY_PUBLIC_VIEWED: {
    description: 'Consulta pública del estado de una PQRS por número de radicado',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_ACUSE_ERROR: {
    description: 'Error al enviar el acuse de recibo de la solicitud de contacto',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_ACUSE_NO_EMAIL: {
    description: 'Acuse de recibo no enviado — solicitud de contacto sin correo',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_ACUSE_SMS_FAILED: {
    description: 'Error al enviar el acuse de recibo por SMS de la solicitud de contacto',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_ALERT_ADMIN_ERROR: {
    description: 'Error al enviar la alerta de nueva solicitud de contacto al administrador',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  CONTACT_INQUIRY_ALERT_ADMIN_NO_EMAIL: {
    description: 'Alerta a administrador no enviada — correo de administrador no configurado',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  CONTACT_INQUIRY_AUTO_ASSIGNED: {
    description: 'Solicitud de contacto (PQRS) auto-asignada al asesor de soporte con menor carga',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  SUPPORT_POOL_EMPTY: {
    description: 'Sin asesores de Atención al Cliente activos — solicitud de contacto (PQRS) quedó sin asignar',
    category: AUDIT_CATEGORIES.PQRS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },

  // ── CONSENTIMIENTOS (gate de acceso, Ley 1581/2012) ──────────────────────
  CONSENT_VERIFIED_OK: {
    description: 'Consentimiento obligatorio verificado y vigente — acceso permitido',
    category: AUDIT_CATEGORIES.CONSENTS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  CONSENT_VERIFIED_FAIL: {
    description: 'Acceso denegado — consentimiento obligatorio ausente, no vigente o no configurado',
    category: AUDIT_CATEGORIES.CONSENTS,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  }
};
