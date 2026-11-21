// ================================================================
// IAM — ADMIN (usuarios internos y control de acceso por roles)
// Módulo: modules/admin/iam/
// Services: admin-user, admin-rbac
// ================================================================

import auditCatalogModule from './audit-catalog';
const { AUDIT_CATEGORIES, AUDIT_RISKS } = auditCatalogModule;

export default {
  // ── USUARIOS INTERNOS ─────────────────────────────────────────

  INTERNAL_USER_LIST_VIEWED: {
    description: 'Listado de usuarios internos consultado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.MEDIUM
  },
  INTERNAL_USER_VIEWED: {
    description: 'Detalle de usuario interno consultado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.MEDIUM
  },
  INTERNAL_USER_CREATED: {
    alert: true,
    description: 'Nuevo usuario interno creado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.CRITICAL
  },
  INTERNAL_USER_UPDATED: {
    description: 'Datos de usuario interno actualizados por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.HIGH
  },
  INTERNAL_USER_ROLE_CHANGED: {
    alert: true,
    description: 'Rol de usuario interno modificado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.CRITICAL
  },
  INTERNAL_USER_ACTIVATED: {
    alert: true,
    description: 'Usuario interno activado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.HIGH
  },
  INTERNAL_USER_DEACTIVATED: {
    alert: true,
    description: 'Usuario interno desactivado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.HIGH
  },
  INTERNAL_USER_DELETED: {
    description: 'Usuario interno eliminado (ofuscación irreversible) por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.CRITICAL
  },
  INTERNAL_USER_DELETED_LIST_VIEWED: {
    description: 'Listado histórico de usuarios internos eliminados consultado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.MEDIUM
  },
  INTERNAL_USER_SESSIONS_VIEWED: {
    description: 'Sesiones activas de usuario interno consultadas por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.MEDIUM
  },
  INTERNAL_USER_SESSIONS_CLOSED: {
    alert: true,
    description: 'Sesiones activas de usuario interno cerradas por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.HIGH
  },
  INTERNAL_USER_CHANGE_LOGS_VIEWED: {
    description: 'Bitácora de cambios de usuario interno consultada por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.MEDIUM
  },
  INTERNAL_USER_ROLE_OPTIONS_VIEWED: {
    description: 'Catálogo de roles internos (para filtro de listado) consultado por administrador',
    category: AUDIT_CATEGORIES.INTERNAL_USERS,
    risk: AUDIT_RISKS.LOW
  },

  // ── RBAC (CONTROL DE ACCESO POR ROLES) ────────────────────────

  RBAC_CATALOG_VIEWED: {
    description: 'Catálogo de módulos y permisos RBAC consultado por administrador',
    category: AUDIT_CATEGORIES.RBAC,
    risk: AUDIT_RISKS.LOW
  },
  RBAC_ROLES_VIEWED: {
    description: 'Matriz de roles RBAC consultada por administrador',
    category: AUDIT_CATEGORIES.RBAC,
    risk: AUDIT_RISKS.LOW
  },
  RBAC_EFFECTIVE_PERMISSIONS_VIEWED: {
    description: 'Permisos efectivos del usuario consultados',
    category: AUDIT_CATEGORIES.RBAC,
    risk: AUDIT_RISKS.LOW
  },
  RBAC_ROLE_PERMISSIONS_VIEWED: {
    description: 'Permisos personalizados de un rol consultados por administrador',
    category: AUDIT_CATEGORIES.RBAC,
    risk: AUDIT_RISKS.LOW
  },
  RBAC_PERMISSION_GRANTED: {
    alert: true,
    description: 'Permiso otorgado a un rol por administrador',
    category: AUDIT_CATEGORIES.RBAC,
    risk: AUDIT_RISKS.CRITICAL
  },
  RBAC_PERMISSION_REVOKED: {
    alert: true,
    description: 'Permiso revocado de un rol por administrador',
    category: AUDIT_CATEGORIES.RBAC,
    risk: AUDIT_RISKS.CRITICAL
  }
};
