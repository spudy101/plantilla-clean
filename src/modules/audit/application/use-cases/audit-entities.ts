// Entidades a las que se atribuyen los eventos de auditoría que produce el propio módulo audit.
export const AUDIT_LOG_ENTITY = { entityType: 'AuditLog', entityTable: 'audit_logs' } as const;
export const AUDIT_ALERT_ENTITY = { entityType: 'AuditAlert', entityTable: 'audit_alerts' } as const;
/** Catálogo en memoria, sin tabla. */
export const ACTION_CATALOG_ENTITY = { entityType: 'AuditActionCatalog', entityTable: null } as const;
export const OPERATION_ENTITY = { entityType: 'Operation', entityTable: 'operations' } as const;
export const SESSION_ENTITY = { entityType: 'AuthSession', entityTable: 'user_sessions' } as const;
