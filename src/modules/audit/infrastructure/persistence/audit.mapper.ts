// Mappers fila de Prisma ↔ modelos de audit. Es el único lugar que conoce las dos formas.
import type {
  AuditAlert as AuditAlertRow,
  AuditLog as AuditLogRow,
  Operation as OperationRow
} from '../../../../shared/infrastructure/database/generated/prisma/client';
import type { UserRef as UserRefRow } from '../../../../shared/infrastructure/database/user-ref';
import type { AuditAlertEntry, AuditLogEntry, UserRef } from '../../domain/audit-log';
import type { ChangedByRole, ChangeLogEntry, ChangeType } from '../../domain/account-change';
import type { OperationEntry } from '../../domain/operation';

/** Lo que guarda `details` de un USER_FIELD_CHANGED. */
interface ChangeDetails {
  changeType?: ChangeType;
  changedByRole?: ChangedByRole;
  previousValue?: string | null;
  newValue?: string | null;
  changeReason?: string | null;
}

export const AuditMapper = {
  userRef(row: UserRefRow | null | undefined): UserRef | null {
    return row ? { userId: row.userId, username: row.username, person: row.person } : null;
  },

  /** Todas las columnas, en el orden de la tabla (la copia fría serializa este objeto). */
  auditLogToDomain(row: AuditLogRow): AuditLogEntry {
    return {
      auditLogId: row.auditLogId,
      action: row.action,
      description: row.description,
      category: row.category,
      risk: row.risk,
      outcome: row.outcome,
      userId: row.userId,
      correlationId: row.correlationId,
      ip: row.ip,
      userAgent: row.userAgent,
      fingerprint: row.fingerprint,
      details: row.details,
      source: row.source,
      entityId: row.entityId,
      entityType: row.entityType,
      entityTable: row.entityTable,
      module: row.module,
      sessionId: row.sessionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  },

  auditAlertToDomain(row: AuditAlertRow, users: Map<string, UserRefRow>): AuditAlertEntry {
    return {
      auditAlertId: row.auditAlertId,
      auditLogId: row.auditLogId,
      action: row.action,
      category: row.category,
      risk: row.risk,
      userId: row.userId,
      entityId: row.entityId,
      entityType: row.entityType,
      message: row.message,
      acknowledged: row.acknowledged,
      acknowledgedBy: row.acknowledgedBy,
      acknowledgedAt: row.acknowledgedAt,
      createdAt: row.createdAt,
      actor: AuditMapper.userRef(row.userId ? users.get(row.userId) : null),
      acknowledgedByUser: AuditMapper.userRef(row.acknowledgedBy ? users.get(row.acknowledgedBy) : null)
    };
  },

  /** Un registro USER_FIELD_CHANGED leído como cambio de la bitácora. */
  changeLogToDomain(row: AuditLogRow): ChangeLogEntry {
    const d = (row.details ?? {}) as ChangeDetails;
    return {
      logId: row.auditLogId,
      userId: row.entityId ?? '',
      changedByUserId: row.userId,
      changedByRole: d.changedByRole ?? 'system',
      changeType: d.changeType as ChangeType,
      previousValue: d.previousValue ?? null,
      newValue: d.newValue ?? null,
      changeReason: d.changeReason ?? null,
      ipAddress: row.ip,
      userAgent: row.userAgent,
      originSessionId: row.sessionId,
      createdAt: row.createdAt
    };
  },

  operationToDomain(row: OperationRow): OperationEntry {
    return {
      operationId: row.operationId,
      parentId: row.parentId,
      clientRequestId: row.clientRequestId,
      source: row.source,
      name: row.name,
      status: row.status,
      httpStatus: row.httpStatus,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      userId: row.userId,
      sessionId: row.sessionId,
      ip: row.ip,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationMs: row.durationMs
    };
  }
};
