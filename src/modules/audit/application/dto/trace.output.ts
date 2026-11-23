// Salidas de la traza de operaciones, la traza de sesiones y el feed de actividad del usuario.
// Lista blanca: ni payloads de proveedores, ni details, ni datos de terceros en el feed del cliente.
import type { PageMetadata } from '../../../../shared/application/pagination';
import type { AuditLogEntry, AuditLogWithExecutor } from '../../domain/audit-log';
import { logsInsightsQueryFor, type OperationEntry } from '../../domain/operation';
import { describeChange, type FeedItem } from '../../domain/activity-feed';
import type { TracedSession } from '../ports/session-directory.port';
import { toAuditLogListItemOutput, toUserRefOutput } from './audit-log.output';

// ── Operaciones ──

export function toOperationOutput(o: OperationEntry) {
  return {
    operationId: o.operationId,
    parentId: o.parentId,
    clientRequestId: o.clientRequestId,
    source: o.source,
    name: o.name,
    status: o.status,
    httpStatus: o.httpStatus,
    errorCode: o.errorCode,
    errorMessage: o.errorMessage,
    userId: o.userId,
    sessionId: o.sessionId,
    ip: o.ip,
    startedAt: o.startedAt,
    endedAt: o.endedAt,
    durationMs: o.durationMs
  };
}

export function toOperationTimelineOutput({
  operation,
  children,
  auditEvents
}: {
  operation: OperationEntry;
  children: OperationEntry[];
  auditEvents: AuditLogEntry[];
}) {
  return {
    operation: toOperationOutput(operation),
    children: children.map(toOperationOutput),
    auditEvents: auditEvents.map(a => ({
      auditLogId: a.auditLogId,
      action: a.action,
      description: a.description,
      outcome: a.outcome,
      risk: a.risk,
      userId: a.userId,
      entityType: a.entityType,
      entityId: a.entityId,
      at: a.createdAt
    })),
    logsQuery: logsInsightsQueryFor(operation.operationId)
  };
}

// ── Sesiones ──

export function toSessionHeaderOutput(session: TracedSession, actionCount = 0) {
  const { device } = session;
  return {
    sessionId: session.sessionId,
    status: session.status,
    ipAddress: session.ipAddress || null,
    userAgent: session.userAgent || null,
    startedAt: session.startedAt,
    lastAccessAt: session.lastAccessAt,
    closedAt: session.closedAt || null,
    closeReason: session.closeReason || null,
    createdAt: session.createdAt,
    user: toUserRefOutput(session.user),
    userId: session.userId,
    device: device
      ? {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
          browser: device.browser || null,
          os: device.os || null,
          status: device.status
        }
      : null,
    actionCount
  };
}

export function toTimelineEventOutput(log: AuditLogWithExecutor, hasDetail: boolean) {
  return { ...toAuditLogListItemOutput(log), hasDetail };
}

export interface EntityGroupOutput {
  entityTable: string;
  entityType: string;
  count: number;
  items: unknown[];
}

export function toSessionEntitiesOutput(sessionId: string, entities: EntityGroupOutput[], skipped: Array<{ entityTable: string; count: number }>) {
  return { sessionId, entities, skipped };
}

// ── Feed de actividad del usuario ──

type DeviceBySession = Map<string, { deviceId: string; name: string | null } | null>;
const deviceOf = (devices: DeviceBySession, sessionId: string | null) => (sessionId ? devices.get(sessionId) ?? null : null);

export function toActivityItemOutput(item: FeedItem, devices: DeviceBySession) {
  if (item.source === 'audit') {
    const row = item.activity;
    return {
      activityId: row.auditLogId,
      source: 'audit_log',
      action: row.action,
      description: row.description ?? null,
      category: row.category ?? null,
      outcome: row.outcome ?? null,
      changedByRole: 'user',
      ip: row.ip ?? null,
      device: deviceOf(devices, row.sessionId),
      occurredAt: row.createdAt ?? null
    };
  }
  const row = item.change;
  return {
    activityId: row.logId,
    source: 'user_change_log',
    action: row.changeType,
    description: describeChange(row.changeType),
    category: 'profile',
    outcome: 'success',
    changedByRole: row.changedByRole,
    ip: null,
    // Solo se resuelve si la sesión es del PROPIO usuario: un cambio de un admin sale con device null
    device: deviceOf(devices, row.originSessionId),
    occurredAt: row.createdAt ?? null
  };
}

export function toActivityFeedOutput(items: FeedItem[], metadata: PageMetadata, devices: DeviceBySession) {
  return { data: items.map(item => toActivityItemOutput(item, devices)), metadata };
}
