// Puerto de persistencia de los registros de auditoría (audit_logs, append-only: no hay update ni delete,
// salvo la purga de retención). Lo implementa infrastructure/persistence/prisma-audit-log.repository.ts.
import type { PageRequest } from '../../../../shared/application/pagination';
import type { AuditLogEntry, AuditLogWithExecutor, NewAuditLog } from '../../domain/audit-log';
import type { OwnActivity } from '../../domain/activity-feed';
import type { EntityRef } from '../../domain/session-trace';

export interface Page<T> {
  rows: T[];
  count: number;
}

/** Los intentos de autenticación (la vista de sesiones de iam): por acciones o, sin ellas, por categoría. */
export interface AuthAttemptCriteria {
  from: Date;
  to: Date;
  actions?: string[];
  category?: string;
  userId?: string;
  outcome?: string;
}

/** Filtros del listado y la exportación (solo los que llegaron). */
export interface AuditLogFilters {
  dateFrom?: Date | string;
  dateTo?: Date | string;
  action?: string;
  userId?: string;
  sessionId?: string;
  category?: string;
  module?: string;
  outcome?: string;
  risk?: string;
  ip?: string;
  correlationId?: string;
  entityId?: string;
  entityType?: string;
  source?: string;
}

export interface AuditLogRepository {
  /**
   * Guarda un registro. Por defecto dentro de la unidad de trabajo en curso (el hecho y su auditoría juntos o
   * ninguno); `independent` lo escribe aparte (un intento fallido debe quedar aunque el flujo se revierta).
   */
  append(log: NewAuditLog, options: { independent: boolean }): Promise<AuditLogEntry>;

  search(filters: AuditLogFilters, page: PageRequest): Promise<Page<AuditLogWithExecutor>>;
  findById(auditLogId: string): Promise<AuditLogWithExecutor | null>;
  findAuthAttempts(criteria: AuthAttemptCriteria, page: PageRequest): Promise<Page<AuditLogWithExecutor>>;
  /** Para exportar: los más recientes primero, hasta `limit`. */
  findForExport(filters: AuditLogFilters, limit: number): Promise<AuditLogEntry[]>;

  /** Hechos de negocio de una operación, en orden cronológico. */
  findByCorrelationId(correlationId: string): Promise<AuditLogEntry[]>;

  /** Registros de una sesión, con quién los ejecutó. */
  findBySession(sessionId: string, page: PageRequest): Promise<Page<AuditLogWithExecutor>>;
  /** Cuántos registros tiene cada sesión (las que no tienen ninguno no aparecen). */
  countBySessions(sessionIds: string[]): Promise<Map<string, number>>;
  /** Filas de dominio (tabla + id) tocadas en una sesión. */
  findEntityRefsBySession(sessionId: string): Promise<EntityRef[]>;

  /** Lo que hizo el usuario, solo de las acciones indicadas, del más reciente al más antiguo. */
  findOwnActivity(userId: string, actions: readonly string[], window: { limit: number; offset: number }): Promise<Page<OwnActivity>>;

  // Retención
  /** Registros creados en [from, to), en orden. */
  findCreatedBetween(from: Date, to: Date): Promise<AuditLogEntry[]>;
  countCreatedUpTo(cutoff: Date): Promise<number>;
  countCreatedBefore(cutoff: Date): Promise<number>;
  /** La única baja permitida: borra lo creado antes de `cutoff` (la copia vive en S3). */
  purgeCreatedBefore(cutoff: Date): Promise<number>;
}
