// ================================================================
// APPROVALS — SYSTEM (doble aprobación global)
// Worker: modules/schemas/core/workers/dual-approval-expiration.worker.js
//
// Acción disparada por el worker de expiración — userId = 'system'.
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  DUAL_APPROVAL_EXPIRED: {
    description: 'Solicitud de doble aprobación marcada como expirada por TTL vencido (worker)',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.MEDIUM,
    module: AUDIT_MODULES.SYSTEM
  }
};
