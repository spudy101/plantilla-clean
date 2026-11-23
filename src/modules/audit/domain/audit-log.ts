// Registros de auditoría (audit_logs) y alertas (audit_alerts): modelos de solo lectura. audit_logs es
// append-only (la base lo garantiza con un trigger): un registro no cambia nunca después de escrito.
import { actorUserId, definitionOf, isRecordedIndependently, type AuditOutcome, type AuditSource } from './audit-action';

/** Usuario que se muestra junto a un registro (quién ejecutó, quién reconoció…). */
export interface UserRef {
  userId: string;
  username: string | null;
  person: { firstName: string | null; lastName: string | null } | null;
}

/**
 * Un registro, con todas sus columnas: la copia fría de S3 es este objeto serializado tal cual (el orden de
 * las claves es el de la tabla).
 */
export interface AuditLogEntry {
  auditLogId: string;
  action: string;
  description: string | null;
  category: string | null;
  risk: string;
  outcome: AuditOutcome;
  userId: string | null;
  correlationId: string | null;
  ip: string | null;
  userAgent: string | null;
  fingerprint: string | null;
  details: unknown;
  source: string;
  entityId: string | null;
  entityType: string | null;
  entityTable: string | null;
  module: string | null;
  sessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Registro con quién ejecutó la acción (null si fue el sistema o el usuario ya no existe). */
export interface AuditLogWithExecutor extends AuditLogEntry {
  executor: UserRef | null;
}

export interface AuditAlertEntry {
  auditAlertId: string;
  auditLogId: string | null;
  action: string;
  category: string | null;
  risk: string;
  userId: string | null;
  entityId: string | null;
  entityType: string | null;
  message: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
  actor: UserRef | null;
  acknowledgedByUser: UserRef | null;
}

/** Lo que pide quien audita un hecho. */
export interface AuditFact {
  /** Usuario que ejecuta la acción; 'system' (o null) para procesos automáticos o rutas públicas. */
  actorId: string | null | undefined;
  details?: Record<string, unknown>;
  outcome?: AuditOutcome;
  entityId?: string | null;
  entityType?: string | null;
  entityTable?: string | null;
}

/** Quién, desde dónde y en qué operación: sale del contexto de la operación en curso. */
export interface OperationOrigin {
  userId: string | null;
  sessionId: string | null;
  correlationId: string | null;
  ip: string | null;
  userAgent: string | null;
  fingerprint: string | null;
  source: AuditSource;
}

/** Registro listo para guardar. */
export type NewAuditLog = Omit<AuditLogEntry, 'auditLogId' | 'createdAt' | 'updatedAt'>;

/** Alerta lista para guardar, enlazada al registro que la disparó. */
export type NewAuditAlert = Pick<AuditAlertEntry, 'auditLogId' | 'action' | 'category' | 'risk' | 'userId' | 'entityId' | 'entityType' | 'message'>;

/** Cómo se registra un hecho: clasificado con el catálogo y con el origen de la operación. */
export function auditLogFor(action: string, fact: AuditFact, origin: OperationOrigin): { log: NewAuditLog; independent: boolean } {
  const def = definitionOf(action);
  const outcome = fact.outcome ?? 'success';
  return {
    independent: isRecordedIndependently(outcome),
    log: {
      action,
      description: def.description,
      category: def.category,
      risk: def.risk,
      module: def.module ?? null,
      outcome,
      userId: actorUserId(fact.actorId ?? origin.userId),
      sessionId: origin.sessionId,
      correlationId: origin.correlationId,
      ip: origin.ip,
      userAgent: origin.userAgent,
      fingerprint: origin.fingerprint,
      source: origin.source,
      details: fact.details ?? {},
      entityId: fact.entityId ?? null,
      entityType: fact.entityType ?? null,
      entityTable: fact.entityTable ?? null
    }
  };
}

/** La alerta que dispara un registro, o null si su acción no alerta. */
export function alertFor(saved: Pick<AuditLogEntry, 'auditLogId' | 'action' | 'userId' | 'entityId' | 'entityType'>): NewAuditAlert | null {
  const def = definitionOf(saved.action);
  if (!def.alert) {
    return null;
  }
  return {
    auditLogId: saved.auditLogId,
    action: saved.action,
    category: def.category,
    risk: def.risk,
    userId: saved.userId,
    entityId: saved.entityId,
    entityType: saved.entityType,
    message: def.description || saved.action
  };
}

/** Nombre para mostrar de un usuario. */
export function fullNameOf(user: UserRef): string | null {
  return [user.person?.firstName, user.person?.lastName].filter(Boolean).join(' ') || null;
}
