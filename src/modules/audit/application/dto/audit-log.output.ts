// Salidas de los registros, alertas y bitácora de cambios (datos planos). La presentación las documenta con
// los esquemas Zod de presentation/http/responses/.
import MaskingUtil from '../../../../shared/domain/pii/masking.util';
import { fullNameOf, type AuditAlertEntry, type AuditLogEntry, type AuditLogWithExecutor, type UserRef } from '../../domain/audit-log';
import { maskChangeValue, type ChangeLogWithUsers } from '../../domain/account-change';

export function toUserRefOutput(user: UserRef | null | undefined) {
  if (!user) {
    return null;
  }
  return { userId: user.userId, username: user.username, fullName: fullNameOf(user) };
}

export function toAuditLogListItemOutput(log: AuditLogWithExecutor) {
  return {
    auditLogId: log.auditLogId,
    action: log.action,
    description: log.description || null,
    category: log.category || null,
    module: log.module || null,
    risk: log.risk,
    outcome: log.outcome,
    userId: log.userId || null,
    sessionId: log.sessionId || null,
    executor: toUserRefOutput(log.executor),
    entityId: log.entityId || null,
    entityType: log.entityType || null,
    entityTable: log.entityTable || null,
    ip: log.ip || null,
    source: log.source,
    createdAt: log.createdAt
  };
}

export function toAuditLogDetailOutput(log: AuditLogWithExecutor) {
  return {
    ...toAuditLogListItemOutput(log),
    correlationId: log.correlationId || null,
    userAgent: log.userAgent || null,
    fingerprint: log.fingerprint || null,
    // [RF-USR-01] CA-06: `details` es JSON libre (diffs con correos y documentos en claro) → se redacta por clave
    details: (MaskingUtil.redactPayload(log.details) as Record<string, unknown> | null) || null
  };
}

/** Columnas de la exportación CSV/XLSX, en orden. */
export const AUDIT_LOG_EXPORT_COLUMNS = [
  'audit_log_id',
  'action',
  'description',
  'category',
  'risk',
  'outcome',
  'user_id',
  'session_id',
  'entity_id',
  'entity_type',
  'correlation_id',
  'ip',
  'source',
  'created_at'
] as const;
export type AuditLogExportRow = Record<(typeof AUDIT_LOG_EXPORT_COLUMNS)[number], string | Date | null>;

export function toAuditLogExportRow(log: AuditLogEntry): AuditLogExportRow {
  return {
    audit_log_id: log.auditLogId,
    action: log.action,
    description: log.description,
    category: log.category,
    risk: log.risk,
    outcome: log.outcome,
    user_id: log.userId,
    session_id: log.sessionId,
    entity_id: log.entityId,
    entity_type: log.entityType,
    correlation_id: log.correlationId,
    ip: log.ip,
    source: log.source,
    created_at: log.createdAt
  };
}

export function toAuditAlertOutput(alert: AuditAlertEntry) {
  return {
    alertId: alert.auditAlertId,
    auditLogId: alert.auditLogId || null,
    action: alert.action,
    category: alert.category || null,
    risk: alert.risk,
    userId: alert.userId || null,
    user: toUserRefOutput(alert.actor),
    entityId: alert.entityId || null,
    entityType: alert.entityType || null,
    message: alert.message || null,
    acknowledged: alert.acknowledged,
    acknowledgedBy: alert.acknowledgedBy || null,
    acknowledgedByUser: toUserRefOutput(alert.acknowledgedByUser),
    acknowledgedAt: alert.acknowledgedAt || null,
    createdAt: alert.createdAt
  };
}

export function toChangeLogOutput(log: ChangeLogWithUsers) {
  return {
    logId: log.logId,
    userId: log.userId,
    user: toUserRefOutput(log.user),
    changedByUserId: log.changedByUserId || null,
    changedByRole: log.changedByRole,
    changedBy: toUserRefOutput(log.changedBy),
    changeType: log.changeType,
    previousValue: maskChangeValue(log.previousValue, log.changeType) as string | null,
    newValue: maskChangeValue(log.newValue, log.changeType) as string | null,
    changeReason: log.changeReason || null,
    ipAddress: log.ipAddress || null,
    userAgent: log.userAgent || null,
    originSessionId: log.originSessionId || null,
    createdAt: log.createdAt
  };
}
