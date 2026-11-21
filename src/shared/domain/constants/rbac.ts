// shared/constants/rbac.ts
//
// ============================================================================
// RBAC — Control de Acceso Basado en Roles (RF-ADM-01)
// ============================================================================
//
// Único lugar donde vive la definición de roles, los módulos del sistema, sus
// AGRUPACIONES para el front y la MATRIZ DE PERMISOS BASE (rol → módulos → acciones).
//
// ─── Por qué la matriz vive en código y no en BD ─────────────────────────────
//   Los permisos BASE de cada rol son "no modificables": es ESQUEMA (solo cambia
//   cuando el negocio redefine un rol, y eso amerita deploy + revisión). En código
//   quedan inmutables, versionados en git e imposibles de corromper en caliente.
//   Una capa granular editable en runtime (fases futuras) se fusionaría sobre esta
//   base dentro de RbacService.can(), sin tocar middleware ni rutas.
//
// ─── Roles del template ──────────────────────────────────────────────────────
//   El template trae 4 roles. Los permisos finos se derivan de la matriz base:
//     SUPERADMIN → acceso total (*) y omite la doble aprobación (auto-aprueba).
//     ADMIN      → acceso total (*) pero SÍ sujeto a doble aprobación.
//     AUDITOR    → solo lectura en todos los módulos.
//     CLIENTE    → rol externo (portal cliente); sin acceso al panel admin.
//   La distinción SUPERADMIN vs ADMIN frente a la doble aprobación la resuelve
//   DualApprovalService (SUPERADMIN_ROLE_NAMES omite el gate). Ver
//   shared/constants/dual-approval.js.

// ============================================================================
// COMODÍN — se usa tanto para "todos los módulos" como para "todas las acciones".
// ============================================================================
const RBAC_WILDCARD = '*' as const;

// ============================================================================
// ROLES — el valor es el `name` exacto guardado en la tabla `roles`
// ============================================================================
const RBAC_ROLES = {
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  AUDITOR: 'AUDITOR',
  CLIENTE: 'CLIENTE'
};

// ============================================================================
// MÓDULOS del sistema sobre los que se conceden permisos (GRANULARES)
// ============================================================================
// Un módulo por sección/recurso del panel admin. El id es plano y en inglés.
// La etiqueta humana y la agrupación viven en RBAC_MODULE_GROUPS (abajo).
const RBAC_MODULES = {
  // ── Administración ──────────────────────────────────────────────────────
  ROLES_PERMISSIONS: 'rolesPermissions',
  INTERNAL_USERS: 'internalUsers',
  DUAL_APPROVAL: 'dualApproval',
  SYSTEM_CONFIG: 'systemConfig',
  PROMOTIONAL_CONTENT: 'promotionalContent',

  // ── Clientes ────────────────────────────────────────────────────────────
  CLIENTS_LIST: 'clientsList',
  POLICY_ACCEPTANCE: 'policyAcceptance',

  // ── Integraciones ───────────────────────────────────────────────────────
  PROVIDERS: 'providers',

  // ── Auditoría ───────────────────────────────────────────────────────────
  GLOBAL_LOGS: 'globalLogs',
  AUDIT_ACTION_CATALOG: 'auditActionCatalog',
  SYSTEM_ALERTS: 'systemAlerts',
  USER_CHANGES: 'userChanges',
  ACTIVE_SESSIONS: 'activeSessions',

  // ── Notificaciones ──────────────────────────────────────────────────────
  NOTIFICATION_DELIVERIES: 'notificationDeliveries',
  NOTIFICATION_MANAGEMENT: 'notificationManagement',

  // ── Consentimientos ─────────────────────────────────────────────────────
  CONSENT_TYPES: 'consentTypes',
  PRIVACY_POLICIES: 'privacyPolicies'
};

// ============================================================================
// AGRUPACIONES de módulos (para el árbol de permisos del front)
// ============================================================================
// Cada grupo: { key, label (ES), description (ES), modules: [{ id, label, description }] }.
// El orden del array es el orden de despliegue. listCatalog() lo devuelve tal cual.
const RBAC_MODULE_GROUPS = [
  {
    key: 'rolesPermissions',
    parent: 'administration',
    label: 'Roles y Permisos',
    description: 'Matriz de roles y permisos (RBAC) del sistema.',
    modules: [
      { id: RBAC_MODULES.ROLES_PERMISSIONS, label: 'Roles y Permisos', description: 'Define qué puede ver y hacer cada rol.' }
    ]
  },
  {
    key: 'internalUsers',
    parent: 'administration',
    label: 'Usuarios Internos',
    description: 'Empleados que acceden al panel administrativo.',
    modules: [
      {
        id: RBAC_MODULES.INTERNAL_USERS,
        label: 'Usuarios Internos',
        description: 'Alta, rol y estado de los empleados internos.'
      }
    ]
  },
  {
    key: 'dualApproval',
    parent: 'administration',
    label: 'Doble Aprobación',
    description: 'Operaciones sensibles bajo esquema maker-checker.',
    modules: [
      {
        id: RBAC_MODULES.DUAL_APPROVAL,
        label: 'Doble Aprobación',
        description: 'Aprobar/rechazar operaciones sensibles pendientes.'
      }
    ]
  },
  {
    key: 'systemConfig',
    parent: 'administration',
    label: 'Configuración Global',
    description: 'Parámetros globales del sistema.',
    modules: [
      {
        id: RBAC_MODULES.SYSTEM_CONFIG,
        label: 'Configuración Global',
        description: 'Parámetros globales del sistema (retención, resiliencia, etc.).'
      }
    ]
  },
  {
    key: 'promotionalContent',
    parent: 'administration',
    label: 'Contenido Promocional',
    description: 'Banners promocionales de la landing y la app del cliente.',
    modules: [
      {
        id: RBAC_MODULES.PROMOTIONAL_CONTENT,
        label: 'Banners Promocionales',
        description: 'Crear, editar y publicar los banners del front.'
      }
    ]
  },
  {
    key: 'clients',
    label: 'Clientes',
    description: 'Clientes finales y su información KYC.',
    modules: [
      { id: RBAC_MODULES.CLIENTS_LIST, label: 'Listado de Clientes', description: 'Directorio de clientes finales.' },
      {
        id: RBAC_MODULES.POLICY_ACCEPTANCE,
        label: 'Aceptación de Políticas',
        description: 'Políticas aceptadas por el cliente y su evidencia.'
      }
    ]
  },
  {
    key: 'integrations',
    label: 'Integraciones',
    description: 'Estado y trazabilidad de las integraciones externas.',
    modules: [
      { id: RBAC_MODULES.PROVIDERS, label: 'Proveedores', description: 'Proveedores externos y su disponibilidad.' }
    ]
  },
  {
    key: 'audit',
    label: 'Auditoría',
    description: 'Auditoría inmutable y seguridad del sistema.',
    modules: [
      { id: RBAC_MODULES.GLOBAL_LOGS, label: 'Logs Globales', description: 'Bitácora global de auditoría (fuente de verdad).' },
      {
        id: RBAC_MODULES.AUDIT_ACTION_CATALOG,
        label: 'Catálogo de Acciones de Auditoría',
        description: 'Catálogo de acciones auditables del sistema.'
      },
      { id: RBAC_MODULES.SYSTEM_ALERTS, label: 'Alertas del Sistema', description: 'Alertas por errores y eventos críticos.' },
      { id: RBAC_MODULES.USER_CHANGES, label: 'Cambios de Usuarios', description: 'Historial de cambios sobre usuarios.' },
      { id: RBAC_MODULES.ACTIVE_SESSIONS, label: 'Sesiones Activas', description: 'Sesiones activas y cierre remoto.' }
    ]
  },
  {
    key: 'notifications',
    label: 'Notificaciones',
    description: 'Notificaciones a clientes (email, push y SMS).',
    modules: [
      {
        id: RBAC_MODULES.NOTIFICATION_DELIVERIES,
        label: 'Entregas de Notificaciones',
        description: 'Consulta de entregas por canal (push, email, SMS).'
      },
      {
        id: RBAC_MODULES.NOTIFICATION_MANAGEMENT,
        label: 'Gestión de Notificaciones',
        description: 'Tipos de notificación y envíos globales.'
      }
    ]
  },
  {
    key: 'consents',
    label: 'Consentimientos',
    description: 'Consentimientos legales y políticas de privacidad.',
    modules: [
      {
        id: RBAC_MODULES.CONSENT_TYPES,
        label: 'Tipos de Consentimientos',
        description: 'Tipos de consentimiento configurables.'
      },
      {
        id: RBAC_MODULES.PRIVACY_POLICIES,
        label: 'Políticas de Privacidad',
        description: 'Versiones de las políticas de privacidad.'
      }
    ]
  },
  // Contenedor de menú "Administración" — agrupa visualmente los grupos de gobierno del sistema
  // (los que lo referencian por `parent`). No tiene módulos propios: es solo el nodo padre del árbol
  // que devuelve GET /rbac/modules.
  {
    key: 'administration',
    label: 'Administración',
    description: 'Gobierno del sistema: roles y permisos, usuarios internos, doble aprobación y configuración global.',
    modules: []
  }
];

// ============================================================================
// ACCIONES (CRUD)
// ============================================================================
const RBAC_ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete'
};

const ALL_ACTIONS = Object.values(RBAC_ACTIONS);
const { READ } = RBAC_ACTIONS;

// ============================================================================
// MATRIZ DE PERMISOS BASE
// ============================================================================
// Formato por rol:
//   - RBAC_WILDCARD ('*')           → acceso total (todos los módulos y acciones)
//   - { '*': [acciones] }           → esas acciones en CUALQUIER módulo
//   - { [modulo]: [acciones] }      → acciones permitidas en ese módulo
//   - {}                            → sin permisos (mínimo privilegio)
/** Acciones permitidas sobre un módulo: lista explícita o comodín ('*' = todas). */
type ModulePermission = string[] | typeof RBAC_WILDCARD;
/** Permisos base de un rol: comodín total o mapa módulo → acciones (la clave '*' aplica a todos los módulos). */
type RolePermissionSet = typeof RBAC_WILDCARD | Record<string, ModulePermission>;

const ROLE_PERMISSIONS: Record<string, RolePermissionSet> = {
  // Acceso total. SUPERADMIN además omite la doble aprobación (ver dual-approval.js).
  [RBAC_ROLES.SUPERADMIN]: RBAC_WILDCARD,
  // Acceso total pero SÍ sujeto a doble aprobación en las operaciones sensibles.
  [RBAC_ROLES.ADMIN]: RBAC_WILDCARD,
  // Solo lectura en todos los módulos.
  [RBAC_ROLES.AUDITOR]: { [RBAC_WILDCARD]: [READ] },
  // Rol externo: no accede al panel admin.
  [RBAC_ROLES.CLIENTE]: {}
};

// ============================================================================
// CLASIFICACIÓN DE ROLES — internos (empleados) vs externos
// ============================================================================
// Usado por:
//   - auth.middleware → aplicar expiración de sesión de 15 min SOLO a internos.
//   - auth-login._checkServerRole → permitir acceso al portal admin.
const EXTERNAL_ROLE_NAMES = [RBAC_ROLES.CLIENTE];

// Roles de cliente final. Fuente única para:
//   - admin-person.list → el listado de clientes solo muestra estos roles.
//   - notificación global → solo se envía a clientes finales.
const CLIENT_ROLE_NAMES = [RBAC_ROLES.CLIENTE];

// Todos los roles que NO son externos se consideran usuarios internos (SUPERADMIN, ADMIN, AUDITOR).
const INTERNAL_ROLE_NAMES = Object.values(RBAC_ROLES).filter(roleName => !EXTERNAL_ROLE_NAMES.includes(roleName));

// Roles internos con acceso completo al panel admin (acceso total en la matriz).
const ADMIN_FULL_ACCESS_ROLES = [RBAC_ROLES.SUPERADMIN, RBAC_ROLES.ADMIN];

// Nombres de rol que identifican a un superadministrador. Fuente única para el bypass de doble
// aprobación (DualApprovalService.isSuperAdmin) y userRepository.findActiveUsersByRoleNames().
const SUPERADMIN_ROLE_NAMES = [RBAC_ROLES.SUPERADMIN];

// Roles destinatarios de las notificaciones por correo dirigidas "al admin".
const ADMIN_NOTIFICATION_ROLE_NAMES = [RBAC_ROLES.SUPERADMIN, RBAC_ROLES.ADMIN];

export default {
  RBAC_WILDCARD,
  RBAC_ROLES,
  RBAC_MODULES,
  RBAC_MODULE_GROUPS,
  RBAC_ACTIONS,
  ALL_ACTIONS,
  ROLE_PERMISSIONS,
  EXTERNAL_ROLE_NAMES,
  CLIENT_ROLE_NAMES,
  INTERNAL_ROLE_NAMES,
  ADMIN_FULL_ACCESS_ROLES,
  SUPERADMIN_ROLE_NAMES,
  ADMIN_NOTIFICATION_ROLE_NAMES
};
