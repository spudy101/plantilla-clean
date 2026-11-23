// Reglas del dominio audit: clasificación con el catálogo, alertas, bitácora de cambios, catálogo de
// acciones, feed de actividad, retención y traza de sesiones. TypeScript puro, sin mocks.
import { actorUserId, definitionOf } from './audit-action';
import { alertFor, auditLogFor, fullNameOf, type OperationOrigin } from './audit-log';
import { accountChangeFact, maskChangeValue } from './account-change';
import { categoriesWithCounts, modulesWithCounts, risksWithCounts, searchActions } from './action-catalog';
import { describeChange, mergeFeed, sessionIdsOf, type ExternalChange, type OwnActivity } from './activity-feed';
import { archiveKeyOf, expiringCutoff, hotYearsOf, purgeCutoff, utcDayOf } from './retention';
import { hasDetail, idsByTable } from './session-trace';

const UUID = '6f1f0a7e-3b8a-4d63-9a59-2f0c2b9b1c11';
const origin: OperationOrigin = {
  userId: null,
  sessionId: 's-1',
  correlationId: 'corr-1',
  ip: '10.0.0.1',
  userAgent: 'jest',
  fingerprint: 'fp',
  source: 'http'
};

describe('clasificación de un registro', () => {
  it('toma descripción, categoría, riesgo y módulo del catálogo, y el origen de la operación', () => {
    const { log, independent } = auditLogFor('SYSTEM_GLOBAL_CONFIG_UPDATED', { actorId: UUID, entityId: 'cfg' }, origin);
    expect(independent).toBe(false);
    expect(log).toMatchObject({
      action: 'SYSTEM_GLOBAL_CONFIG_UPDATED',
      category: 'Configuración',
      risk: 'high',
      outcome: 'success',
      userId: UUID,
      sessionId: 's-1',
      correlationId: 'corr-1',
      details: {},
      entityId: 'cfg',
      entityType: null
    });
  });

  it('una acción fuera del catálogo se registra sin clasificar', () => {
    expect(definitionOf('NO_EXISTE')).toEqual({ description: 'NO_EXISTE', category: 'Sin categoría', risk: 'unknown' });
  });

  it("un actor que no es un usuario ('system') no se guarda como usuario; sin actor, el de la operación", () => {
    expect(actorUserId('system')).toBeNull();
    expect(auditLogFor('X', { actorId: null }, { ...origin, userId: UUID }).log.userId).toBe(UUID);
  });

  it('un intento fallido se escribe aparte de la unidad de trabajo', () => {
    expect(auditLogFor('AUTH_FAILURE', { actorId: null, outcome: 'failure' }, origin).independent).toBe(true);
  });

  it('solo las acciones con alert disparan una alerta, enlazada al registro', () => {
    const saved = { auditLogId: 'log-1', action: 'SYSTEM_GLOBAL_CONFIG_UPDATED', userId: UUID, entityId: null, entityType: null };
    expect(alertFor(saved)).toMatchObject({ auditLogId: 'log-1', risk: 'high', userId: UUID });
    expect(alertFor({ ...saved, action: 'AUDIT_LOG_LISTED' })).toBeNull();
  });

  it('nombre para mostrar', () => {
    expect(fullNameOf({ userId: UUID, username: 'a', person: { firstName: 'Ana', lastName: null } })).toBe('Ana');
    expect(fullNameOf({ userId: UUID, username: 'a', person: null })).toBeNull();
  });
});

describe('bitácora de cambios', () => {
  it('el actor es quien lo hizo; si fue el propio usuario, él; si no, el sistema', () => {
    const change = { userId: UUID, changedByRole: 'user' as const, changeType: 'email' as const, previousValue: 'a@b.co', newValue: 'c@d.co' };
    expect(accountChangeFact(change)).toMatchObject({
      actorId: UUID,
      entityType: 'User',
      entityTable: 'users',
      entityId: UUID,
      details: { changeType: 'email', changedByRole: 'user', previousValue: 'a@b.co', newValue: 'c@d.co', changeReason: null }
    });
    expect(accountChangeFact({ ...change, changedByRole: 'system' }).actorId).toBe('system');
    expect(accountChangeFact({ ...change, changedByRole: 'admin', changedByUserId: 'admin-1' }).actorId).toBe('admin-1');
  });

  it('enmascara correos, documentos y teléfonos; un estado pasa intacto', () => {
    expect(maskChangeValue('ana@correo.com', 'email')).not.toBe('ana@correo.com');
    expect(maskChangeValue('1234567890', 'national_id')).not.toBe('1234567890');
    expect(maskChangeValue('activo', 'account_status')).toBe('activo');
    expect(maskChangeValue(null, 'email')).toBeNull();
  });
});

describe('catálogo de acciones', () => {
  it('categorías en orden alfabético, riesgos de menor a mayor, módulos con su conteo', () => {
    const categories = categoriesWithCounts().map(c => c.category);
    expect(categories).toEqual([...categories].sort((a, b) => a.localeCompare(b, 'es')));
    expect(risksWithCounts().map(r => r.risk)).toEqual(['low', 'medium', 'high', 'critical']);
    expect(modulesWithCounts().every(m => m.actionsCount >= 0)).toBe(true);
  });

  it('busca por código o descripción sin distinguir mayúsculas, filtra y ordena', () => {
    const found = searchActions({ search: '  system_global_config  ' }, 'ASC');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(a => a.action.includes('SYSTEM_GLOBAL_CONFIG') || a.description.toLowerCase().includes('system_global_config'))).toBe(true);
    const asc = searchActions({ risk: 'high' }, 'ASC').map(a => a.action);
    expect(searchActions({ risk: 'high' }, 'DESC').map(a => a.action)).toEqual([...asc].reverse());
    expect(searchActions({ module: 'system' }, 'ASC').every(a => a.module === 'system')).toBe(true);
  });
});

describe('feed de actividad', () => {
  const own = (id: string, at: string, sessionId: string | null = null): OwnActivity => ({
    auditLogId: id,
    action: 'LOGIN_SUCCESS',
    description: null,
    category: null,
    outcome: 'success',
    ip: null,
    sessionId,
    createdAt: new Date(at)
  });
  const external = (id: string, at: string, originSessionId: string | null = null): ExternalChange => ({
    logId: id,
    changeType: 'email',
    changedByRole: 'admin',
    originSessionId,
    createdAt: new Date(at)
  });

  it('mezcla por fecha (más reciente primero) y corta la página', () => {
    const items = mergeFeed([own('a1', '2026-01-01'), own('a2', '2026-01-03')], [external('c1', '2026-01-02')], 1, 2);
    expect(items.map(i => (i.source === 'audit' ? i.activity.auditLogId : i.change.logId))).toEqual(['c1', 'a1']);
  });

  it('sesiones únicas de la página, sin nulos', () => {
    expect(sessionIdsOf(mergeFeed([own('a', '2026-01-01', 's1'), own('b', '2026-01-02', 's1')], [external('c', '2026-01-03')], 0, 10))).toEqual(['s1']);
  });

  it('describe un cambio al usuario', () => {
    expect(describeChange('password')).toBe('Cambio de contraseña');
    expect(describeChange('otro')).toBe('Actualización de datos de la cuenta');
  });
});

describe('retención', () => {
  const now = new Date('2026-06-15T10:00:00Z');

  it('5 años por defecto; los cortes de aviso y de purga', () => {
    expect(hotYearsOf(null)).toBe(5);
    expect(hotYearsOf({ hotYears: 7, hotPurgeEnabled: false })).toBe(7);
    expect(expiringCutoff(now, 5).getFullYear()).toBe(2022);
    expect(purgeCutoff(now, 5).getFullYear()).toBe(2021);
  });

  it('el día UTC completo y su key en S3', () => {
    const { from, to } = utcDayOf(new Date('2026-03-04T23:59:00Z'));
    expect(from.toISOString()).toBe('2026-03-04T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(archiveKeyOf(from)).toBe('audit-logs/2026/03/04.jsonl');
  });
});

describe('traza de sesión', () => {
  it('agrupa ids únicos por tabla y puede acotar a una', () => {
    const refs = [
      { entityTable: 'a', entityId: '1' },
      { entityTable: 'b', entityId: '2' },
      { entityTable: 'a', entityId: '1' },
      { entityTable: 'a', entityId: '3' }
    ];
    expect([...idsByTable(refs, null)]).toEqual([
      ['a', ['1', '3']],
      ['b', ['2']]
    ]);
    expect([...idsByTable(refs, 'b')]).toEqual([['b', ['2']]]);
  });

  it('un evento tiene detalle si su tabla se sabe mostrar y apunta a una fila', () => {
    const known = new Set(['user_consents']);
    expect(hasDetail({ entityTable: 'user_consents', entityId: 'x' }, known)).toBe(true);
    expect(hasDetail({ entityTable: 'user_consents', entityId: null }, known)).toBe(false);
    expect(hasDetail({ entityTable: 'otra', entityId: 'x' }, known)).toBe(false);
  });
});
