// Puerto de auditoría: registrar un hecho de negocio (quién hizo qué sobre qué entidad).
//
// Lo usan los casos de uso de cualquier módulo. Lo implementa el módulo audit (RecordAuditEvent): src/main/container.ts
// crea audit primero y entrega su `trail` a los demás. Un caso de uso nunca importa el módulo audit.

export interface AuditEntry {
  /** Usuario que ejecuta la acción; null para procesos automáticos. */
  actorId: string | null;
  details?: Record<string, unknown>;
  outcome?: 'success' | 'failure' | 'warning' | 'attempt';
  entityId?: string | null;
  entityType?: string | null;
  entityTable?: string | null;
}

export interface AuditTrail {
  /** @param action clave del catálogo de acciones auditables (p. ej. 'SYSTEM_GLOBAL_CONFIG_UPDATED') */
  record(action: string, entry: AuditEntry): Promise<void>;
}
