// shared/constants/dual-approval.ts
//
// Registro declarativo del framework de doble aprobación (maker-checker / cuatro ojos).
// Agregar una operación = agregar una entrada aquí (parte declarativa estilo audit-alert-triggers).
// El "quién/cuándo" del segundo aprobador vive en la tabla genérica `approval_requests`.
//
// ⚠️ SIEMPRE ACTIVO: no existe interruptor para apagar el framework. Cada operación se gatea según
// su `condition` (ALWAYS, o THRESHOLD sobre un campo del payload). NO comentar este archivo para
// desactivarlo: el middleware y el bootstrap lo requieren al arrancar y el server no levantaría.

// Roles con acceso total que SIEMPRE pueden resolver (además de los approverRoles de cada op).
const WILDCARD_ROLES = ['SUPERADMIN', 'ADMIN'];

// Condiciones soportadas para gatear una operación.
const CONDITION = {
  ALWAYS: 'always',
  THRESHOLD: 'threshold'
} as const;

// TTL por defecto (horas hábiles) si una operación no declara `ttlHours`.
const DEFAULT_TTL_HOURS = 72;

/**
 * Registro de operaciones gateadas.
 *
 * Campos por operación:
 *   label              {string}  — nombre legible para el front / auditoría
 *   approverRoles      {string[]}— roles autorizados a resolver (además de WILDCARD_ROLES)
 *   notificationType   {string}  — code del notification_type para avisar a los aprobadores
 *   entityType         {string}  — tipo de entidad afectada (para join/annotate)
 *   entityTable        {string}  — tabla de la entidad (para logAudit)
 *   condition          {string}  — CONDITION.ALWAYS | CONDITION.THRESHOLD
 *   thresholdField     {string?} — (threshold) campo del payload a comparar
 *   thresholdConfigKey {string?} — (threshold) key en SystemGlobalConfig que sobreescribe el default
 *   thresholdDefault   {number?} — (threshold) umbral por defecto si no hay override en BD
 *   ttlHours           {number}  — horas hábiles hasta expirar la solicitud
 */
const OPS = {
  // Cambio de rol de un usuario. El segundo aprobador es otro ADMIN (SUPERADMIN lo omite por rol).
  RBAC_ROLE_CHANGE: {
    label: 'Cambio de rol de usuario',
    approverRoles: ['ADMIN'],
    notificationType: 'RBAC_SECOND_APPROVER',
    entityType: 'User',
    entityTable: 'users',
    condition: CONDITION.ALWAYS,
    ttlHours: 72
  },
  // Eliminación de cuenta de cliente (ofuscación irreversible) → siempre exige segundo aprobador.
  CLIENT_ACCOUNT_DELETE: {
    label: 'Eliminación de cuenta de cliente',
    approverRoles: ['ADMIN'],
    notificationType: 'RBAC_SECOND_APPROVER',
    entityType: 'User',
    entityTable: 'users',
    condition: CONDITION.ALWAYS,
    ttlHours: 72
  },
  // Eliminación de usuario interno (ofuscación irreversible) → siempre exige segundo aprobador.
  INTERNAL_USER_DELETE: {
    label: 'Eliminación de usuario interno',
    approverRoles: ['ADMIN'],
    notificationType: 'RBAC_SECOND_APPROVER',
    entityType: 'User',
    entityTable: 'users',
    condition: CONDITION.ALWAYS,
    ttlHours: 72
  }
};

/** Definición de una operación gateada (ver los campos arriba). */
interface DualApprovalOp {
  label: string;
  approverRoles: string[];
  notificationType: string;
  entityType: string;
  entityTable: string;
  condition: (typeof CONDITION)[keyof typeof CONDITION];
  thresholdField?: string;
  thresholdConfigKey?: string;
  thresholdDefault?: number;
  ttlHours?: number;
}

// satisfies valida cada entrada; la anotación conserva las claves literales y deja los campos
// opcionales (threshold*) accesibles en cualquier operación.
const DUAL_APPROVAL_OPS: Record<keyof typeof OPS, DualApprovalOp> = OPS satisfies Record<string, DualApprovalOp>;

const DualApproval = {
  WILDCARD_ROLES,
  CONDITION,
  DEFAULT_TTL_HOURS,
  DUAL_APPROVAL_OPS
};

// eslint-disable-next-line @typescript-eslint/no-namespace, @typescript-eslint/no-redeclare
declare namespace DualApproval {
  type Op = DualApprovalOp;
  type OpKey = keyof typeof OPS;
}

export default DualApproval;
