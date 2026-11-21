// ================================================================
// AUDIT — SYSTEM (verificación automática de integridad)
// Módulo: modules/schemas/audit/
// Workers: binding-integrity.worker (verificación diaria a las
//          2 AM de la integridad criptográfica de todos los
//          expedientes de vinculación sellados)
//
// Acciones disparadas automáticamente por el worker — userId='system'.
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS } = auditCatalogModule;

export default {
  BINDING_INTEGRITY_CHECK_COMPLETED: {
    description: 'Verificación diaria de integridad de expedientes de vinculación completada por el sistema',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.LOW
  },

  BINDING_INTEGRITY_VIOLATION_DETECTED: {
    description: 'Violación de integridad detectada — hash del expediente de vinculación no coincide',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.CRITICAL
  },

  // ── Sellado fallido (§6 del plan de trazabilidad) ──────────────
  // Los tres sellados corren best-effort en setImmediate: si fallan, el flujo de negocio
  // continúa SIN sello. Antes solo quedaba un logger.warn silencioso; ahora emiten alerta.
  BINDING_DOSSIER_SEAL_FAILED: {
    description: 'Falló el sellado del expediente de vinculación — el perfil quedó completo sin su expediente probatorio',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.CRITICAL
  },

  // Detectado por el worker de integridad: una entidad que DEBERÍA tener sello no lo tiene.
  BINDING_DOSSIER_SEAL_MISSING: {
    description: 'El worker de integridad detectó una entidad probatoria sin su expediente de vinculación sellado',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.CRITICAL
  },

  AUDIT_LOG_PURGE_EXECUTED: {
    alert: true,
    description: 'Purga de registros de auditoría vencidos ejecutada desde BD por el worker de retención (RF-ADM-03)',
    category: AUDIT_CATEGORIES.AUDIT,
    risk: AUDIT_RISKS.CRITICAL
  }
};
