// ================================================================
// KYC — SYSTEM (workers / cron del dominio de autenticación y sesiones)
// Worker: modules/schemas/kyc/workers/session-expiration.worker.js
//
// Acciones disparadas por workers — userId = 'system'.
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  SESSION_EXPIRED_BY_WORKER: {
    description: 'Sesión cerrada por el worker de expiración por inactividad (last_access_at + 15 min)',
    category: AUDIT_CATEGORIES.AUTH,
    risk: AUDIT_RISKS.LOW,
    module: AUDIT_MODULES.SYSTEM
  },
  INSTITUTIONAL_EMAILS_EXPIRED_BY_WORKER: {
    description: 'Registros de correo institucional marcados como expirados por fin de semestre (worker diario)',
    category: AUDIT_CATEGORIES.KYC,
    risk: AUDIT_RISKS.LOW,
    module: AUDIT_MODULES.SYSTEM
  }
};
