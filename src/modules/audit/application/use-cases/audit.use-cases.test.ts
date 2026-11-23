// Casos de uso de audit con dobles en memoria de sus puertos: sin jest.mock, sin Prisma, sin S3.
import { RecordAuditEvent } from './record-audit-event.use-case';
import { RecordAccountChange } from './record-account-change.use-case';
import { ListAuditLogs } from './list-audit-logs.use-case';
import { GetAuditLog } from './get-audit-log.use-case';
import { ExportAuditLogs, EXPORT_LIMIT } from './export-audit-logs.use-case';
import { ListAuditAlerts } from './list-audit-alerts.use-case';
import { AcknowledgeAuditAlert, AcknowledgeAuditAlerts } from './acknowledge-audit-alerts.use-case';
import { GetAuditCategories, ListAuditActions } from './audit-action-catalog.use-cases';
import { ListUserChangeLogs } from './list-user-change-logs.use-case';
import { GetOperationTimeline, ListOperations } from './operations.use-cases';
import { GetSessionEntities, GetSessionTimeline, ListSessionTraces } from './session-trace.use-cases';
import { GetRecentActivity } from './get-recent-activity.use-case';
import { ExportAuditDay, PurgeTechnicalData, RunAuditRetention } from './retention.use-cases';
import { AuditLogNotFoundError, OperationNotFoundError, PendingAlertNotFoundError, SessionNotFoundError } from '../../domain/errors';
import { RecordingAuditTrail, RecordingNotifier, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import {
  auditAlert,
  auditLog,
  FixedOperationContext,
  FixedRetentionSettings,
  InMemoryArchive,
  InMemoryAuditAlerts,
  InMemoryAuditLogs,
  InMemoryChangeLogs,
  InMemoryOperations,
  InMemorySessions,
  LOG_ID,
  operation,
  SESSION_ID,
  StubTechnicalRetention,
  tracedSession,
  USER_ID
} from '../../../../../tests/doubles/audit.doubles';

const ADMIN = 'admin-1';
const PAGE = { page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' as const };
const flushImmediate = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

describe('RecordAuditEvent', () => {
  const build = (logs = new InMemoryAuditLogs(), alerts = new InMemoryAuditAlerts(), ctx = new FixedOperationContext(), logger = silentLogger) => ({
    logs,
    alerts,
    useCase: new RecordAuditEvent(logs, alerts, ctx, logger)
  });

  it('clasifica, toma el origen de la operación y, si la acción alerta, crea la alerta enlazada', async () => {
    const { logs, alerts, useCase } = build();
    await useCase.execute('SYSTEM_GLOBAL_CONFIG_UPDATED', { actorId: USER_ID, details: { f: 1 } });

    expect(logs.appended).toEqual([
      {
        independent: false,
        log: expect.objectContaining({ action: 'SYSTEM_GLOBAL_CONFIG_UPDATED', risk: 'high', userId: USER_ID, correlationId: 'corr-1', details: { f: 1 } })
      }
    ]);
    expect(alerts.created).toEqual([{ independent: false, alert: expect.objectContaining({ auditLogId: 'log-1', action: 'SYSTEM_GLOBAL_CONFIG_UPDATED' }) }]);
  });

  it('una acción sin alert no crea alerta; un intento fallido se escribe aparte', async () => {
    const { logs, alerts, useCase } = build();
    await useCase.execute('AUTH_FAILURE', { actorId: null, outcome: 'failure' });
    expect(logs.appended[0]?.independent).toBe(true);
    expect(alerts.created).toEqual([]);
  });

  it('dentro de una unidad de trabajo, si la escritura falla, relanza (el cambio se revierte con ella)', async () => {
    const logs = new InMemoryAuditLogs();
    logs.failWith = new Error('BD caída');
    const { useCase } = build(logs, undefined, new FixedOperationContext(undefined, true));
    await expect(useCase.execute('AUDIT_LOG_LISTED', { actorId: ADMIN })).rejects.toThrow('BD caída');
  });

  it('fuera de una unidad de trabajo, si la escritura falla, lo reporta y no rompe el flujo', async () => {
    const logs = new InMemoryAuditLogs();
    logs.failWith = new Error('BD caída');
    const logger = { ...silentLogger, error: jest.fn() };
    const { useCase } = build(logs, undefined, new FixedOperationContext(), logger);
    await expect(useCase.execute('AUDIT_LOG_LISTED', { actorId: ADMIN })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('No se pudo registrar la auditoría', expect.objectContaining({ action: 'AUDIT_LOG_LISTED', error: 'BD caída' }));
  });

  it('RecordAccountChange registra un USER_FIELD_CHANGED sobre la cuenta', async () => {
    const { logs, useCase } = build();
    await new RecordAccountChange(useCase).execute({ userId: USER_ID, changedByRole: 'user', changeType: 'password' });
    expect(logs.appended[0]?.log).toMatchObject({ action: 'USER_FIELD_CHANGED', userId: USER_ID, entityId: USER_ID, entityTable: 'users' });
  });
});

describe('logs de auditoría', () => {
  it('ListAuditLogs: pasa solo los filtros con valor, informa los aplicados y audita', async () => {
    const logs = new InMemoryAuditLogs();
    logs.rows = [auditLog()];
    const audit = new RecordingAuditTrail();

    const result = await new ListAuditLogs(logs, audit).execute({ actorId: ADMIN, query: { ...PAGE, action: 'LOGIN_SUCCESS', userId: null } });

    expect(logs.calls[0]?.args[0]).toEqual({ action: 'LOGIN_SUCCESS' });
    expect(result.data[0]).toMatchObject({ auditLogId: LOG_ID, executor: { userId: USER_ID, fullName: 'Ana Pérez' } });
    expect(result.metadata.filters).toEqual({ action: 'LOGIN_SUCCESS' });
    expect(audit.entries[0]).toMatchObject({ action: 'AUDIT_LOG_LISTED', details: { totalItems: 1, filters: ['action'] }, entityTable: 'audit_logs' });
  });

  it('GetAuditLog: 404 si no existe; el detalle redacta details y audita', async () => {
    const logs = new InMemoryAuditLogs();
    const audit = new RecordingAuditTrail();
    await expect(new GetAuditLog(logs, audit).execute({ actorId: ADMIN, auditLogId: LOG_ID })).rejects.toBeInstanceOf(AuditLogNotFoundError);

    logs.rows = [auditLog({ details: { before: { email: 'ana@correo.com' } } })];
    const detail = await new GetAuditLog(logs, audit).execute({ actorId: ADMIN, auditLogId: LOG_ID });
    expect(JSON.stringify(detail.details)).not.toContain('ana@correo.com');
    expect(audit.entries[0]).toMatchObject({ action: 'AUDIT_LOG_VIEWED', entityId: LOG_ID });
  });

  it('ExportAuditLogs: filas con todas las columnas, marca truncado y audita', async () => {
    const logs = new InMemoryAuditLogs();
    logs.rows = [auditLog()];
    const audit = new RecordingAuditTrail();

    const { rows, truncated } = await new ExportAuditLogs(logs, audit, silentLogger).execute({ actorId: ADMIN, filters: { risk: 'low' }, format: 'csv' });

    expect(logs.calls[0]?.args).toEqual([{ risk: 'low' }, EXPORT_LIMIT]);
    expect(truncated).toBe(false);
    expect(rows[0]).toMatchObject({ audit_log_id: LOG_ID, user_id: USER_ID, session_id: SESSION_ID, correlation_id: 'corr-1' });
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
    expect(audit.entries[0]).toMatchObject({ action: 'AUDIT_LOG_EXPORTED', details: { format: 'csv', count: 1, truncated: false } });
  });
});

describe('alertas', () => {
  it('ListAuditAlerts: metadata con pendingCount y audita', async () => {
    const alerts = new InMemoryAuditAlerts([auditAlert()], 4);
    const audit = new RecordingAuditTrail();
    const result = await new ListAuditAlerts(alerts, audit).execute({ actorId: ADMIN, query: { ...PAGE, acknowledged: false } });

    expect(alerts.listCalls[0]?.filters).toEqual({ acknowledged: false, dateFrom: undefined, dateTo: undefined, action: undefined, category: undefined });
    expect(result.metadata).toMatchObject({ pendingCount: 4, filters: { acknowledged: false } });
    expect(audit.entries[0]).toMatchObject({ action: 'AUDIT_ALERT_LISTED', details: { totalItems: 1, pending: 4 } });
  });

  it('AcknowledgeAuditAlert: 404 si no estaba pendiente; si sí, audita, avisa después y devuelve la alerta', async () => {
    const alert = auditAlert();
    const alerts = new InMemoryAuditAlerts([alert]);
    const notifier = new RecordingNotifier();
    const useCase = new AcknowledgeAuditAlert(alerts, new RecordingAuditTrail(), notifier, silentLogger, 'https://logo');

    const result = await useCase.execute({ actorId: ADMIN, alertId: alert.auditAlertId });
    expect(result).toMatchObject({ alertId: alert.auditAlertId, acknowledged: true });
    expect(notifier.sent).toEqual([]);
    await flushImmediate();
    expect(notifier.sent[0]).toMatchObject({ type: 'AUDIT_ALERT_ACKNOWLEDGED', userId: ADMIN, metadata: { alertId: alert.auditAlertId, logoUrl: 'https://logo' } });

    await expect(useCase.execute({ actorId: ADMIN, alertId: alert.auditAlertId })).rejects.toBeInstanceOf(PendingAlertNotFoundError);
  });

  it('AcknowledgeAuditAlerts: informa cuántas reconoció de las pedidas', async () => {
    const alerts = new InMemoryAuditAlerts([auditAlert(), auditAlert({ auditAlertId: 'otra', acknowledged: true })]);
    const result = await new AcknowledgeAuditAlerts(alerts, new RecordingAuditTrail(), new RecordingNotifier(), silentLogger, '').execute({
      actorId: ADMIN,
      alertIds: [auditAlert().auditAlertId, 'otra', 'no-existe']
    });
    expect(result).toEqual({ acknowledged: 1, requested: 3 });
  });
});

describe('catálogo de acciones', () => {
  it('categorías y búsqueda paginada auditan sin esperar', () => {
    const audit = new RecordingAuditTrail();
    expect(new GetAuditCategories(audit).execute({ actorId: ADMIN }).data.length).toBeGreaterThan(0);

    const page = new ListAuditActions(audit).execute({ actorId: ADMIN, query: { page: 2, limit: 1, sortBy: 'action', order: 'ASC', risk: 'high' } });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).not.toHaveProperty('alert');
    expect(page.metadata.filters).toEqual({ risk: 'high' });
    expect(audit.entries.map(e => e.action)).toEqual(['AUDIT_ACTION_CATALOG_CATEGORIES_VIEWED', 'AUDIT_ACTION_CATALOG_ACTIONS_LISTED']);
  });
});

describe('ListUserChangeLogs', () => {
  it('pasa filtros y búsqueda, enmascara valores y audita el usuario consultado', async () => {
    const changes = new InMemoryChangeLogs([
      {
        logId: LOG_ID,
        userId: USER_ID,
        changedByUserId: null,
        changedByRole: 'system',
        changeType: 'email',
        previousValue: 'ana@correo.com',
        newValue: null,
        changeReason: null,
        ipAddress: null,
        userAgent: null,
        originSessionId: null,
        createdAt: new Date(),
        user: null,
        changedBy: null
      }
    ]);
    const audit = new RecordingAuditTrail();

    const result = await new ListUserChangeLogs(changes, audit).execute({ actorId: ADMIN, query: { ...PAGE, userId: USER_ID, search: 'x' } });

    expect(changes.listCalls[0]).toMatchObject({ filters: { userId: USER_ID }, search: 'x' });
    expect(result.data[0]?.previousValue).not.toBe('ana@correo.com');
    expect(result.metadata.filters).toEqual({ search: 'x', userId: USER_ID });
    expect(audit.entries[0]).toMatchObject({ action: 'CHANGE_LOG_VIEWED', entityId: USER_ID, details: { totalItems: 1, page: 1, targetUserId: USER_ID } });
  });
});

describe('operaciones', () => {
  it('ListOperations traduce las fechas a from/to', async () => {
    const ops = new InMemoryOperations([operation()]);
    const from = new Date('2026-01-01');
    const result = await new ListOperations(ops, new RecordingAuditTrail()).execute({ actorId: ADMIN, query: { ...PAGE, dateFrom: from, name: '' } });
    expect(ops.listCalls[0]).toEqual({ source: undefined, status: undefined, userId: undefined, name: undefined, from, to: undefined });
    expect(result.metadata.filters).toEqual({ dateFrom: from });
  });

  it('GetOperationTimeline: une hijas y auditoría por correlationId; 404 si no existe', async () => {
    const parent = operation();
    const ops = new InMemoryOperations([parent, operation({ operationId: 'child', parentId: parent.operationId })]);
    const logs = new InMemoryAuditLogs();
    logs.rows = [auditLog({ correlationId: parent.operationId })];
    const useCase = new GetOperationTimeline(ops, logs, new RecordingAuditTrail());

    const timeline = await useCase.execute({ actorId: ADMIN, operationId: parent.operationId });
    expect(timeline.children.map(c => c.operationId)).toEqual(['child']);
    expect(timeline.auditEvents).toHaveLength(1);
    expect(timeline.logsQuery).toContain(parent.operationId);
    await expect(useCase.execute({ actorId: ADMIN, operationId: 'x' })).rejects.toBeInstanceOf(OperationNotFoundError);
  });
});

describe('traza de sesiones', () => {
  const registry = {
    user_consents: { entityType: 'UserConsent', findByIds: jest.fn(async (ids: string[]) => ids.map(id => ({ id }))) }
  };

  it('ListSessionTraces cuenta las acciones de cada sesión de la página', async () => {
    const sessions = new InMemorySessions([tracedSession(), tracedSession({ sessionId: 'sin-acciones' })]);
    const logs = new InMemoryAuditLogs();
    logs.sessionCounts.set(SESSION_ID, 3);
    const result = await new ListSessionTraces(sessions, logs, new RecordingAuditTrail()).execute({ actorId: ADMIN, query: { ...PAGE, status: 'active' } });
    expect(result.data.map(s => s.actionCount)).toEqual([3, 0]);
    expect(result.data[0]).toMatchObject({ sessionId: SESSION_ID, userId: USER_ID, user: { fullName: 'Ana' }, device: { deviceName: 'Mac' } });
    expect(result.metadata.filters).toEqual({ status: 'active' });
  });

  it('GetSessionTimeline marca hasDetail solo para tablas registradas con id; 404 si no existe', async () => {
    const sessions = new InMemorySessions([tracedSession()]);
    const logs = new InMemoryAuditLogs();
    logs.rows = [auditLog({ entityTable: 'user_consents', entityId: 'c-1' }), auditLog({ entityTable: 'otra', entityId: 'x' })];
    const useCase = new GetSessionTimeline(sessions, logs, registry, new RecordingAuditTrail());

    const result = await useCase.execute({ actorId: ADMIN, sessionId: SESSION_ID, query: PAGE });
    expect(result.timeline.map(e => e.hasDetail)).toEqual([true, false]);
    expect(result.session.actionCount).toBe(2);
    await expect(useCase.execute({ actorId: ADMIN, sessionId: 'x', query: PAGE })).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('GetSessionEntities hidrata por lote y reporta las tablas que no sabe mostrar', async () => {
    const logs = new InMemoryAuditLogs();
    logs.refs = [
      { entityTable: 'user_consents', entityId: 'c-1' },
      { entityTable: 'user_consents', entityId: 'c-1' },
      { entityTable: 'persons', entityId: 'p-1' }
    ];
    const audit = new RecordingAuditTrail();
    const result = await new GetSessionEntities(new InMemorySessions([tracedSession()]), logs, registry, audit).execute({ actorId: ADMIN, sessionId: SESSION_ID });

    expect(result.entities).toEqual([{ entityTable: 'user_consents', entityType: 'UserConsent', count: 1, items: [{ id: 'c-1' }] }]);
    expect(result.skipped).toEqual([{ entityTable: 'persons', count: 1 }]);
    expect(audit.entries[0]).toMatchObject({ details: { sessionId: SESSION_ID, tables: ['user_consents'], skipped: ['persons'] } });
  });
});

describe('GetRecentActivity', () => {
  it('mezcla lo propio con lo externo, resuelve dispositivos solo de sesiones propias y audita', async () => {
    const logs = new InMemoryAuditLogs();
    logs.own = {
      rows: [{ auditLogId: 'a1', action: 'LOGIN_SUCCESS', description: null, category: null, outcome: 'success', ip: null, sessionId: 's1', createdAt: new Date('2026-01-02') }],
      count: 1
    };
    const changes = new InMemoryChangeLogs([], {
      rows: [{ logId: 'c1', changeType: 'email', changedByRole: 'admin', originSessionId: 'admin-session', createdAt: new Date('2026-01-03') }],
      count: 1
    });
    const sessions = new InMemorySessions([], new Map([['s1', { deviceId: 'd1', name: 'Mac' }]]));
    const audit = new RecordingAuditTrail();

    const result = await new GetRecentActivity(logs, changes, sessions, audit).execute({ userId: USER_ID, query: { page: 1, limit: 10 } });

    expect(result.data.map(i => [i.activityId, i.source, i.device])).toEqual([
      ['c1', 'user_change_log', null],
      ['a1', 'audit_log', { deviceId: 'd1', name: 'Mac' }]
    ]);
    expect(result.metadata.pagination.totalItems).toBe(2);
    expect(sessions.deviceLookups[0]).toEqual({ sessionIds: ['admin-session', 's1'], userId: USER_ID });
    expect(audit.entries[0]).toMatchObject({ action: 'RECENT_ACTIVITY_VIEWED', actorId: USER_ID, details: { totalItems: 2, page: 1 } });
  });

  it('sin sesiones en la página no consulta dispositivos', async () => {
    const sessions = new InMemorySessions();
    await new GetRecentActivity(new InMemoryAuditLogs(), new InMemoryChangeLogs(), sessions, new RecordingAuditTrail()).execute({ userId: USER_ID, query: { page: 1, limit: 10 } });
    expect(sessions.deviceLookups).toEqual([]);
  });
});

describe('retención', () => {
  it('RunAuditRetention avisa siempre y purga solo con el flag, auditando inicio y fin', async () => {
    const logs = new InMemoryAuditLogs();
    logs.counts = { upTo: 5, before: 2 };
    const audit = new RecordingAuditTrail();
    const useCase = new RunAuditRetention(logs, new FixedRetentionSettings({ hotYears: 5, hotPurgeEnabled: true }), audit, silentLogger);

    await useCase.execute();
    expect(logs.purged).toEqual([]);

    await useCase.execute({ enableDbPurge: true });
    expect(logs.purged).toHaveLength(1);
    expect(audit.entries.map(e => (e.details as { status: string }).status)).toEqual(['initiated', 'completed']);
  });

  it('la corrida del cron purga solo si la configuración lo activó; un error se loguea', async () => {
    const logs = new InMemoryAuditLogs();
    logs.counts = { upTo: 0, before: 2 };
    await new RunAuditRetention(logs, new FixedRetentionSettings({ hotYears: 5, hotPurgeEnabled: false }), new RecordingAuditTrail(), silentLogger).executeScheduled();
    expect(logs.purged).toEqual([]);
    await new RunAuditRetention(logs, new FixedRetentionSettings(null), new RecordingAuditTrail(), silentLogger).executeScheduled();
    expect(logs.purged).toEqual([]);

    const failing = { read: () => Promise.reject(new Error('x')) };
    const logger = { ...silentLogger, error: jest.fn() };
    await expect(new RunAuditRetention(logs, failing, new RecordingAuditTrail(), logger).execute()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('ExportAuditDay sube el día completo (UTC) como JSONL; sin registros no sube nada', async () => {
    const logs = new InMemoryAuditLogs();
    logs.rows = [auditLog({ createdAt: new Date('2026-01-01T10:00:00Z') })];
    const archive = new InMemoryArchive();
    const useCase = new ExportAuditDay(logs, archive, silentLogger);

    expect(await useCase.execute(new Date('2026-01-01T23:00:00Z'))).toBe(1);
    expect(archive.uploads[0]?.key).toBe('audit-logs/2026/01/01.jsonl');
    expect(JSON.parse(archive.uploads[0]!.body.trim())).toMatchObject({ auditLogId: LOG_ID });

    expect(await useCase.execute(new Date('2026-02-01T00:00:00Z'))).toBe(0);
    expect(archive.uploads).toHaveLength(1);
  });

  it('PurgeTechnicalData corre las dos purgas; si una falla, la otra corre igual y se reporta la falla', async () => {
    const ok = new StubTechnicalRetention();
    await new PurgeTechnicalData(ok, 30, silentLogger).execute();
    expect(ok.operationCutoffs).toHaveLength(1);

    const keys = jest.fn(async () => 0);
    const failing = Object.assign(new StubTechnicalRetention(new Error('ops caídas')), { purgeExpiredIdempotencyKeys: keys });
    await expect(new PurgeTechnicalData(failing, 30, silentLogger).execute()).rejects.toThrow('ops caídas');
    expect(keys).toHaveBeenCalled();
  });
});
