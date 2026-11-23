// tests/doubles/audit.doubles.ts
//
// Dobles en memoria de los puertos de audit, para los tests de los casos de uso.
import type { PageRequest } from '../../src/shared/application/pagination';
import type { AuditLogFilters, AuditLogRepository, Page } from '../../src/modules/audit/application/ports/audit-log-repository.port';
import type { AuditAlertFilters, AuditAlertRepository } from '../../src/modules/audit/application/ports/audit-alert-repository.port';
import type { ChangeLogFilters, ChangeLogRepository } from '../../src/modules/audit/application/ports/change-log-repository.port';
import type { OperationContext } from '../../src/modules/audit/application/ports/operation-context.port';
import type { OperationFilters, OperationReader } from '../../src/modules/audit/application/ports/operation-reader.port';
import type { SessionDirectory, SessionFilters, TracedSession } from '../../src/modules/audit/application/ports/session-directory.port';
import type { AuditArchive } from '../../src/modules/audit/application/ports/audit-archive.port';
import type { TechnicalDataRetention } from '../../src/modules/audit/application/ports/technical-data-retention.port';
import type { RetentionSettingsReader } from '../../src/modules/audit/application/ports/retention-settings.port';
import type {
  AuditAlertEntry,
  AuditLogEntry,
  AuditLogWithExecutor,
  NewAuditAlert,
  NewAuditLog,
  OperationOrigin
} from '../../src/modules/audit/domain/audit-log';
import type { ChangedByRole, ChangeLogWithUsers } from '../../src/modules/audit/domain/account-change';
import type { ExternalChange, OwnActivity } from '../../src/modules/audit/domain/activity-feed';
import type { OperationEntry } from '../../src/modules/audit/domain/operation';
import type { EntityRef } from '../../src/modules/audit/domain/session-trace';
import type { RetentionSettings } from '../../src/modules/audit/domain/retention';

export const USER_ID = '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c11';
export const LOG_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const SESSION_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const AT = new Date('2026-01-01T00:00:00Z');

export const auditLog = (over: Partial<AuditLogWithExecutor> = {}): AuditLogWithExecutor => ({
  auditLogId: LOG_ID,
  action: 'LOGIN_SUCCESS',
  description: 'Inicio de sesión',
  category: 'Autenticación',
  risk: 'low',
  outcome: 'success',
  userId: USER_ID,
  correlationId: 'corr-1',
  ip: '10.0.0.1',
  userAgent: 'jest',
  fingerprint: 'fp',
  details: {},
  source: 'http',
  entityId: null,
  entityType: null,
  entityTable: null,
  module: 'client',
  sessionId: SESSION_ID,
  createdAt: AT,
  updatedAt: AT,
  executor: { userId: USER_ID, username: 'ana', person: { firstName: 'Ana', lastName: 'Pérez' } },
  ...over
});

export const auditAlert = (over: Partial<AuditAlertEntry> = {}): AuditAlertEntry => ({
  auditAlertId: '9b2e8f3c-1d2a-4c5b-8e7f-1a2b3c4d5e6f',
  auditLogId: LOG_ID,
  action: 'RBAC_PERMISSION_GRANTED',
  category: 'RBAC',
  risk: 'high',
  userId: USER_ID,
  entityId: null,
  entityType: null,
  message: 'Permiso otorgado',
  acknowledged: false,
  acknowledgedBy: null,
  acknowledgedAt: null,
  createdAt: AT,
  actor: null,
  acknowledgedByUser: null,
  ...over
});

export const tracedSession = (over: Partial<TracedSession> = {}): TracedSession => ({
  sessionId: SESSION_ID,
  userId: USER_ID,
  status: 'active',
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
  startedAt: AT,
  lastAccessAt: AT,
  closedAt: null,
  closeReason: null,
  createdAt: AT,
  user: { userId: USER_ID, username: 'ana', person: { firstName: 'Ana', lastName: null } },
  device: { deviceId: '4b8e7c2a-9f1d-4e3b-a5c6-7d8e9f0a1b2c', deviceName: 'Mac', deviceType: 'desktop', browser: null, os: 'macOS', status: 'trusted' },
  ...over
});

export const operation = (over: Partial<OperationEntry> = {}): OperationEntry => ({
  operationId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  parentId: null,
  clientRequestId: null,
  source: 'http',
  name: 'GET /x',
  status: 'success',
  httpStatus: 200,
  errorCode: null,
  errorMessage: null,
  userId: USER_ID,
  sessionId: SESSION_ID,
  ip: '10.0.0.1',
  startedAt: AT,
  endedAt: AT,
  durationMs: 12,
  ...over
});

export class FixedOperationContext implements OperationContext {
  constructor(
    public originValue: OperationOrigin = {
      userId: null,
      sessionId: SESSION_ID,
      correlationId: 'corr-1',
      ip: '10.0.0.1',
      userAgent: 'jest',
      fingerprint: 'fp',
      source: 'http'
    },
    public insideUnit = false
  ) {}
  origin() {
    return this.originValue;
  }
  insideUnitOfWork() {
    return this.insideUnit;
  }
}

/** Registros en memoria: guarda lo que se escribió y con qué opciones; los lectores devuelven lo configurado. */
export class InMemoryAuditLogs implements AuditLogRepository {
  readonly appended: Array<{ log: NewAuditLog; independent: boolean }> = [];
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  failWith: Error | null = null;
  rows: AuditLogWithExecutor[] = [];
  sessionCounts = new Map<string, number>();
  refs: EntityRef[] = [];
  own: Page<OwnActivity> = { rows: [], count: 0 };
  counts = { upTo: 0, before: 0 };
  purged: Date[] = [];

  private track(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  async append(log: NewAuditLog, { independent }: { independent: boolean }): Promise<AuditLogEntry> {
    if (this.failWith) {
      throw this.failWith;
    }
    this.appended.push({ log, independent });
    return { ...log, auditLogId: `log-${this.appended.length}`, createdAt: AT, updatedAt: AT };
  }
  async search(filters: AuditLogFilters, page: PageRequest) {
    this.track('search', filters, page);
    return { rows: this.rows, count: this.rows.length };
  }
  async findById(id: string) {
    return this.rows.find(r => r.auditLogId === id) ?? null;
  }
  async findForExport(filters: AuditLogFilters, limit: number) {
    this.track('findForExport', filters, limit);
    return this.rows.slice(0, limit);
  }
  async findByCorrelationId(id: string) {
    return this.rows.filter(r => r.correlationId === id);
  }
  async findBySession(sessionId: string, page: PageRequest) {
    this.track('findBySession', sessionId, page);
    const rows = this.rows.filter(r => r.sessionId === sessionId);
    return { rows, count: rows.length };
  }
  async countBySessions(ids: string[]) {
    this.track('countBySessions', ids);
    return new Map([...this.sessionCounts].filter(([id]) => ids.includes(id)));
  }
  async findEntityRefsBySession() {
    return this.refs;
  }
  async findOwnActivity(userId: string, actions: readonly string[], window: { limit: number; offset: number }) {
    this.track('findOwnActivity', userId, actions, window);
    return this.own;
  }
  async findCreatedBetween(from: Date, to: Date) {
    return this.rows.filter(r => r.createdAt >= from && r.createdAt < to);
  }
  async countCreatedUpTo() {
    return this.counts.upTo;
  }
  async countCreatedBefore() {
    return this.counts.before;
  }
  async purgeCreatedBefore(cutoff: Date) {
    this.purged.push(cutoff);
    return this.counts.before;
  }
}

export class InMemoryAuditAlerts implements AuditAlertRepository {
  readonly created: Array<{ alert: NewAuditAlert; independent: boolean }> = [];
  readonly listCalls: Array<{ filters: AuditAlertFilters; page: PageRequest }> = [];
  constructor(public alerts: AuditAlertEntry[] = [], public pending = 0) {}

  async create(alert: NewAuditAlert, { independent }: { independent: boolean }) {
    this.created.push({ alert, independent });
  }
  async findById(id: string) {
    return this.alerts.find(a => a.auditAlertId === id) ?? null;
  }
  async list(filters: AuditAlertFilters, page: PageRequest) {
    this.listCalls.push({ filters, page });
    return { rows: this.alerts, count: this.alerts.length };
  }
  async countPending() {
    return this.pending;
  }
  async acknowledge(ids: string[], by: string) {
    let changed = 0;
    this.alerts = this.alerts.map(a => {
      if (ids.includes(a.auditAlertId) && !a.acknowledged) {
        changed++;
        return { ...a, acknowledged: true, acknowledgedBy: by };
      }
      return a;
    });
    return changed;
  }
}

export class InMemoryChangeLogs implements ChangeLogRepository {
  readonly listCalls: Array<{ filters: ChangeLogFilters; page: PageRequest; search: string | null }> = [];
  constructor(
    public rows: ChangeLogWithUsers[] = [],
    public external: Page<ExternalChange> = { rows: [], count: 0 }
  ) {}

  async list(filters: ChangeLogFilters, page: PageRequest, search: string | null) {
    this.listCalls.push({ filters, page, search });
    return { rows: this.rows, count: this.rows.length };
  }
  async findChangesBy(_userId: string, _roles: readonly ChangedByRole[]) {
    return this.external;
  }
}

export class InMemoryOperations implements OperationReader {
  readonly listCalls: OperationFilters[] = [];
  constructor(public operations: OperationEntry[] = []) {}

  async list(filters: OperationFilters) {
    this.listCalls.push(filters);
    return { rows: this.operations, count: this.operations.length };
  }
  async findById(id: string) {
    return this.operations.find(o => o.operationId === id) ?? null;
  }
  async findChildren(id: string) {
    return this.operations.filter(o => o.parentId === id);
  }
}

export class InMemorySessions implements SessionDirectory {
  readonly listCalls: SessionFilters[] = [];
  readonly deviceLookups: Array<{ sessionIds: string[]; userId: string }> = [];
  constructor(
    public sessions: TracedSession[] = [],
    public devices = new Map<string, { deviceId: string; name: string | null } | null>()
  ) {}

  async list(filters: SessionFilters) {
    this.listCalls.push(filters);
    return { rows: this.sessions, count: this.sessions.length };
  }
  async findById(id: string) {
    return this.sessions.find(s => s.sessionId === id) ?? null;
  }
  async exists(id: string) {
    return this.sessions.some(s => s.sessionId === id);
  }
  async devicesOfOwnSessions(sessionIds: string[], userId: string) {
    this.deviceLookups.push({ sessionIds, userId });
    return new Map([...this.devices].filter(([id]) => sessionIds.includes(id)));
  }
}

export class FixedRetentionSettings implements RetentionSettingsReader {
  constructor(public settings: RetentionSettings | null = null) {}
  async read() {
    return this.settings;
  }
}

export class InMemoryArchive implements AuditArchive {
  readonly uploads: Array<{ key: string; body: string }> = [];
  async upload(key: string, body: string) {
    this.uploads.push({ key, body });
  }
}

export class StubTechnicalRetention implements TechnicalDataRetention {
  readonly operationCutoffs: Date[] = [];
  constructor(public failOperations: Error | null = null) {}
  async purgeOperationsBefore(cutoff: Date) {
    this.operationCutoffs.push(cutoff);
    if (this.failOperations) {
      throw this.failOperations;
    }
    return 3;
  }
  async purgeExpiredIdempotencyKeys() {
    return 2;
  }
}
