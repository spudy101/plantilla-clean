// ================================================================
// AUDIT ACTIONS — Registro central
// Todos los módulos se unen aquí via spread.
// Agregar cada nuevo archivo de módulo en este index.
// ================================================================

import systemActions from './audit-actions.system';
import kycSharedActions from './audit-actions.kyc-shared';
import kycClientActions from './audit-actions.kyc-client';
import kycAdminActions from './audit-actions.kyc-admin';
import kycSystemActions from './audit-actions.kyc-system';
import iamAdminActions from './audit-actions.iam-admin';
import auditAdminActions from './audit-actions.audit-admin';
import auditSystemActions from './audit-actions.audit-system';
import approvalsAdminActions from './audit-actions.approvals-admin';
import approvalsSystemActions from './audit-actions.approvals-system';
import notificationSharedActions from './audit-actions.notification-shared';
import activityClientActions from './audit-actions.activity-client';
import promotionalActions from './audit-actions.promotional';
import deliveryActions from './audit-actions.delivery';

/** Definición de una acción: cómo se clasifica y si dispara una alerta para el Superadmin. */
export interface AuditActionDef {
  description: string;
  category: string;
  risk: string;
  module?: string;
  /** true → cada registro de esta acción crea además una alerta (audit_alerts). */
  alert?: boolean;
}

const AUDIT_ACTIONS = {
  ...systemActions,
  ...kycSharedActions,
  ...kycClientActions,
  ...kycAdminActions,
  ...kycSystemActions,
  ...iamAdminActions,
  ...auditAdminActions,
  ...auditSystemActions,
  ...approvalsAdminActions,
  ...approvalsSystemActions,
  ...notificationSharedActions,
  ...activityClientActions,
  ...promotionalActions,
  ...deliveryActions
} satisfies Record<string, AuditActionDef>;

/** Nombre de una acción del catálogo: un typo es un error de compilación, no un "Sin categoría". */
export type AuditActionKey = keyof typeof AUDIT_ACTIONS;


// Catálogo canónico (fuente de verdad de category/risk/module). Toda acción
// de AUDIT_ACTIONS usa estos valores — homologación garantizada por el test
// audit-catalog.consistency. Lo consume la API /api/audit-action-catalog/*.
import auditCatalogModule from './audit-catalog';
const {
  AUDIT_CATEGORIES,
  AUDIT_RISKS,
  AUDIT_RISK_ORDER,
  AUDIT_MODULES,
  AUDIT_OUTCOMES,
  AUDIT_SOURCES
} = auditCatalogModule;

export default {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_RISKS,
  AUDIT_RISK_ORDER,
  AUDIT_MODULES,
  AUDIT_OUTCOMES,
  AUDIT_SOURCES
};
