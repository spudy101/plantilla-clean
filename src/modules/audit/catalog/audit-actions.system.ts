// ================================================================
// SYSTEM — Actions genéricos del sistema
// Usados por: error.middleware.js, handleNotFound, redis.util.js
// NO son actions de negocio — representan outcomes de infraestructura
// que la SFC necesita ver cuando una operación no llega a completarse.
//
// Convención: la mayoría se registran con outcome='failure'. La acción de
// conectividad REDIS_CONNECTION_RESTORED representa recuperación (outcome='success');
// el emisor define el outcome.
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS } = auditCatalogModule;

export default {
  // ── CONFIGURACIÓN GLOBAL ──────────────────────────────────────

  SYSTEM_GLOBAL_CONFIG_VIEWED: {
    description: 'Configuración global del sistema consultada por administrador',
    category: AUDIT_CATEGORIES.CONFIGURATION,
    risk: AUDIT_RISKS.LOW
  },
  SYSTEM_GLOBAL_CONFIG_UPDATED: {
    alert: true,
    description: 'Configuración global del sistema modificada por administrador',
    category: AUDIT_CATEGORIES.CONFIGURATION,
    risk: AUDIT_RISKS.HIGH
  },

  // ── AUTENTICACIÓN / AUTORIZACIÓN ──────────────────────────────

  AUTH_FAILURE: {
    description: 'Fallo de autenticación — token inválido, expirado o ausente',
    category: AUDIT_CATEGORIES.AUTH,
    risk: AUDIT_RISKS.HIGH
  },

  ACCESS_DENIED: {
    description: 'Acceso denegado — usuario autenticado sin permiso de rol',
    category: AUDIT_CATEGORIES.AUTH,
    risk: AUDIT_RISKS.HIGH
  },

  // ── ERRORES DE ENTRADA ────────────────────────────────────────

  VALIDATION_FAILURE: {
    description: 'Error de validación — parámetros incorrectos o faltantes en la solicitud',
    category: AUDIT_CATEGORIES.ADMINISTRATION,
    risk: AUDIT_RISKS.LOW
  },

  RESOURCE_NOT_FOUND: {
    description: 'Recurso no encontrado — la entidad o ruta solicitada no existe',
    category: AUDIT_CATEGORIES.ADMINISTRATION,
    risk: AUDIT_RISKS.LOW
  },

  // ── REGLAS DE NEGOCIO ─────────────────────────────────────────

  BUSINESS_RULE_VIOLATION: {
    description: 'Violación de regla de negocio — conflicto de estado, duplicado o límite excedido',
    category: AUDIT_CATEGORIES.ADMINISTRATION,
    risk: AUDIT_RISKS.MEDIUM
  },

  // ── SISTEMA ───────────────────────────────────────────────────

  SYSTEM_ERROR: {
    description: 'Error interno del sistema — excepción no controlada o fallo de infraestructura',
    category: AUDIT_CATEGORIES.ADMINISTRATION,
    risk: AUDIT_RISKS.CRITICAL
  },

  // ── WORKERS / CRONS ───────────────────────────────────────────

  WORKER_CYCLE_FAILED: {
    alert: true,
    description: 'Ciclo de worker/cron abortado por una excepción no controlada — el ciclo no completó',
    category: AUDIT_CATEGORIES.ADMINISTRATION,
    risk: AUDIT_RISKS.HIGH
  },

  // ── CONECTIVIDAD DE INFRAESTRUCTURA ───────────────────────────
  // Emitidas en la TRANSICIÓN (una vez por incidente), no por ocurrencia.

  REDIS_CONNECTION_LOST: {
    alert: true,
    description:
      'Redis no disponible — modo degradado activado (fallback a BD/memoria en rate-limit, revocación de sesión y blocklist)',
    category: AUDIT_CATEGORIES.ADMINISTRATION,
    risk: AUDIT_RISKS.CRITICAL
  },

  REDIS_CONNECTION_RESTORED: {
    description: 'Conexión con Redis restablecida tras un incidente',
    category: AUDIT_CATEGORIES.ADMINISTRATION,
    risk: AUDIT_RISKS.LOW
  }
};
