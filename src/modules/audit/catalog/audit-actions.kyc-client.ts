// ================================================================
// KYC — CLIENT
// Módulo: modules/client/kyc/
// Services: auth-register, auth-biometric, send-verification,
//           profile-completeness, user-consent, person-reference
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  // ── REGISTRO ──────────────────────────────────────────────────
  USER_REGISTERED: {
    description: 'Registro de nuevo usuario en el sistema',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  CREDENTIALS_RESET_REQUESTED: {
    description: 'Solicitud de reset de credenciales (password o MFA)',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  PASSWORD_RESET_CONFIRMED: {
    description: 'Reset de contraseña confirmado mediante token',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  MFA_RESET_CONFIRMED: {
    description: 'Reset de MFA confirmado mediante token',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },

  // ── BIOMÉTRICO (WebAuthn) ─────────────────────────────────────
  BIOMETRIC_REGISTER_START: {
    description: 'Inicio de flujo de registro de huella biométrica',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  BIOMETRIC_REGISTER_SUCCESS: {
    description: 'Credencial biométrica registrada exitosamente',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  BIOMETRIC_REGISTER_INVALID_SIGNATURE: {
    description: 'Firma biométrica inválida durante el registro',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  BIOMETRIC_LOGIN_START: {
    description: 'Inicio de flujo de autenticación biométrica',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  BIOMETRIC_LOGIN_SUCCESS: {
    description: 'Autenticación biométrica completada exitosamente',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  BIOMETRIC_LOGIN_INVALID_SIGNATURE: {
    description: 'Firma biométrica inválida durante la autenticación',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  BIOMETRIC_LOGIN_REPLAY_ATTACK: {
    alert: true,
    description: 'Posible ataque de replay detectado — sign count no incremental',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.CRITICAL
  },
  BIOMETRIC_CREDENTIAL_DELETED: {
    description: 'Credencial biométrica desactivada por el usuario',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },
  BIOMETRIC_CREDENTIALS_VIEWED: {
    description: 'Listado de credenciales biométricas consultado por el usuario',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  BIOMETRIC_LOGIN_BLOCKED_POLICY_UPDATE: {
    description: 'Login biométrico bloqueado — el usuario debe aceptar la nueva política de privacidad',
    category: AUDIT_CATEGORIES.BIOMETRIC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── VERIFICACIÓN DE CONTACTO ───────────────────────────────────
  VERIFICATION_CODE_SENT: {
    description: 'Código de verificación enviado al contacto del usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  VERIFICATION_CODE_VERIFIED: {
    description: 'Código de verificación validado exitosamente',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  VERIFICATION_CODE_FAILED: {
    description: 'Intento de verificación de código fallido',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },

  // ── CONSENTIMIENTOS ───────────────────────────────────────────
  CONSENT_CATALOG_VIEWED: {
    description: 'Catálogo de consentimientos (otorgados y disponibles) consultado por el usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  CONSENT_GRANTED: {
    description: 'Consentimiento otorgado por el usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  CONSENT_REVOKED: {
    description: 'Consentimiento revocado por el usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  CONSENT_RECORD_FAILED: {
    alert: true,
    description: 'No se pudo persistir la constancia de un consentimiento (habeas data)',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.HIGH
  },

  // ── COMPLETITUD DE PERFIL ──────────────────────────────────────
  PROFILE_COMPLETENESS_VIEWED: {
    description: 'Completitud del perfil KYC consultada por usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PROFILE_COMPLETED: {
    description: 'Perfil KYC alcanzó 100% de completitud',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },

  // ── REFERENCIAS PERSONALES ────────────────────────────────────
  PROFILE_REFERENCES_VIEWED: {
    description: 'Listado de referencias personales consultado por usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.LOW
  },
  PROFILE_REFERENCE_CREATED: {
    description: 'Referencia personal creada por usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  PROFILE_REFERENCE_UPDATED: {
    description: 'Referencia personal actualizada por usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  },
  PROFILE_REFERENCE_DELETED: {
    description: 'Referencia personal eliminada por usuario',
    category: AUDIT_CATEGORIES.KYC,
    module: AUDIT_MODULES.CLIENT,
    risk: AUDIT_RISKS.MEDIUM
  }
};
