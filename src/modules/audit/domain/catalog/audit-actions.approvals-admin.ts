// ================================================================
// APPROVALS — ADMIN (doble aprobación global / maker-checker)
// Módulo: modules/admin/core/ + modules/schemas/core/services/dual-approval.service
//
// Acciones ejecutadas por humanos: el maker que origina (REQUESTED) y el
// checker que resuelve (APPROVED / REJECTED), más los GET del panel.
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES } = auditCatalogModule;

export default {
  DUAL_APPROVAL_REQUESTED: {
    alert: true,
    description: 'Operación sensible quedó pendiente de segunda aprobación (maker)',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.HIGH,
    module: AUDIT_MODULES.ADMIN
  },

  DUAL_APPROVAL_APPROVED: {
    alert: true,
    description: 'Segundo aprobador autorizó la operación — se ejecutó la acción real (checker)',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.HIGH,
    module: AUDIT_MODULES.ADMIN
  },

  DUAL_APPROVAL_REJECTED: {
    alert: true,
    description: 'Segundo aprobador rechazó la operación pendiente (checker)',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.HIGH,
    module: AUDIT_MODULES.ADMIN
  },

  DUAL_APPROVAL_AUTO_APPROVED: {
    alert: true,
    description: 'super_admin auto-aprobó una operación sensible — cuatro ojos omitido por rol (maker === checker)',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.HIGH,
    module: AUDIT_MODULES.ADMIN
  },

  APPROVAL_REQUEST_LIST_VIEWED: {
    description: 'Listado de solicitudes de doble aprobación consultado',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.LOW,
    module: AUDIT_MODULES.ADMIN
  },

  APPROVAL_REQUEST_VIEWED: {
    description: 'Detalle de una solicitud de doble aprobación consultado',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.LOW,
    module: AUDIT_MODULES.ADMIN
  },

  APPROVAL_POLICY_VIEWED: {
    description: 'Política de doble aprobación (operaciones gateadas) consultada',
    category: AUDIT_CATEGORIES.DUAL_APPROVAL,
    risk: AUDIT_RISKS.LOW,
    module: AUDIT_MODULES.ADMIN
  }
};
