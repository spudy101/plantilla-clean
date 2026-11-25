// Vista admin de sesiones e intentos de autenticación, revocación de una sesión y el barrido de sesiones vencidas.
import { ExpireSessions, ListAuthAttempts, ListSessions, ListUserAuthAttempts, ListUserSessions, RevokeSession } from './admin-sessions.use-cases';
import { SessionNotFoundError } from '../../domain/errors';
import { ADMIN_ID, CLIENT_ID, iamWorld, PAGE, session, settle } from '../../../../../tests/doubles/iam.doubles';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('listados de sesiones', () => {
  it('lista con los filtros que vinieron, los informa en la metadata y audita', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session(), session({ userSessionId: 's-2', userId: 'u-otro' })];
    const result = await new ListSessions(w).execute({ ...PAGE, userId: CLIENT_ID, sessionId: null }, ADMIN_ID);
    expect(w.sessions.listed[0]).toEqual({ sessionId: undefined, userId: CLIENT_ID, status: undefined, dateFrom: undefined, dateTo: undefined });
    expect(result.data).toHaveLength(1);
    expect(result.metadata).toMatchObject({ pagination: { totalItems: 1 }, filters: { userId: CLIENT_ID } });
    expect(w.audit.find('AUTH_SESSION_LIST_VIEWED')).toMatchObject({ actorId: ADMIN_ID, details: { totalItems: 1 } });
  });

  it('las de un usuario filtran por él y por estado', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session(), session({ userSessionId: 's-2', status: 'closed' })];
    const result = await new ListUserSessions(w).execute(CLIENT_ID, { ...PAGE, status: 'active' }, ADMIN_ID);
    expect(w.sessions.listed[0]).toEqual({ userId: CLIENT_ID, status: 'active' });
    expect(result.data).toHaveLength(1);
    expect(w.audit.find('AUTH_SESSION_BY_USER_VIEWED')).toMatchObject({ details: { targetUserId: CLIENT_ID } });
  });
});

describe('RevokeSession', () => {
  it('cierra la sesión, revoca su JTI, la blacklista, audita y avisa al admin y al usuario', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session()];
    await expect(new RevokeSession(w).execute('s-1', ADMIN_ID)).resolves.toEqual({ sessionId: 's-1', status: 'closed', closeReason: 'revoked_by_admin' });
    await settle();
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'revoked_by_admin' });
    expect(w.refreshTokens.revoked).toEqual(['jti-1']);
    expect(w.revocations.sessions).toEqual(['s-1']);
    expect(w.revocations.invalidatedUsers.size).toBe(0);
    expect(w.audit.find('AUTH_SESSION_REVOKED')).toMatchObject({ actorId: ADMIN_ID, details: { targetUserId: CLIENT_ID, after: { status: 'revoked_by_admin' } } });
    expect(w.notifier.sent.map(n => [n.type, n.userId])).toEqual([
      ['AUTH_SESSION_REVOKED_INTERNAL', ADMIN_ID],
      ['AUTH_SESSION_REVOKED_CLIENT', CLIENT_ID]
    ]);
  });

  it('inexistente 404; ya cerrada 400', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session({ status: 'closed' })];
    await expect(new RevokeSession(w).execute('nada', ADMIN_ID)).rejects.toThrow(SessionNotFoundError);
    await expect(new RevokeSession(w).execute('s-1', ADMIN_ID)).rejects.toThrow('La sesión ya está cerrada');
  });

  it('si Redis falla al revocar, solo se loguea', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session()];
    w.refreshTokens.failing = true;
    w.revocations.failing = true;
    await expect(new RevokeSession(w).execute('s-1', ADMIN_ID)).resolves.toMatchObject({ status: 'closed' });
    await settle();
    expect(w.logger.warnings()).toEqual([
      'Error revocando JTI en Redis al revocar sesión por admin',
      'Error invalidando la sesión en Redis al revocar por admin'
    ]);
  });
});

describe('intentos de autenticación', () => {
  it('por defecto (scope all) filtran por la categoría Autenticación', async () => {
    const w = iamWorld();
    const result = await new ListAuthAttempts(w).execute({ ...PAGE }, ADMIN_ID);
    expect(w.authAttempts.criteria[0]).toEqual({ from: new Date('2000-01-01'), to: expect.any(Date), actions: undefined, category: 'Autenticación', userId: undefined, outcome: undefined });
    expect(result.metadata.filters).toEqual({ scope: 'all' });
    expect(w.audit.find('AUTH_ATTEMPTS_LIST_VIEWED')).toMatchObject({ details: { scope: 'all' } });
  });

  it('scope=login filtra por las acciones de inicio de sesión', async () => {
    const w = iamWorld();
    await new ListAuthAttempts(w).execute({ ...PAGE, scope: 'login', outcome: 'failure' }, ADMIN_ID);
    expect(w.authAttempts.criteria[0]).toMatchObject({
      category: undefined,
      outcome: 'failure',
      actions: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_BLOCKED_DEVICE', 'LOGIN_BLOCKED_POLICY_UPDATE', 'ACCOUNT_BLOCKED', 'REFRESH_TOKEN_REUSE_ATTACK']
    });
  });

  it('los de un usuario fuerzan el userId del path sobre el del query', async () => {
    const w = iamWorld();
    await new ListUserAuthAttempts(w).execute(CLIENT_ID, { ...PAGE, userId: 'otro' } as never, ADMIN_ID);
    expect(w.authAttempts.criteria[0]!.userId).toBe(CLIENT_ID);
    expect(w.audit.find('AUTH_ATTEMPTS_BY_USER_VIEWED')).toMatchObject({ entityId: CLIENT_ID, details: { scope: 'all' } });
  });
});

describe('ExpireSessions', () => {
  it('cierra las inactivas y las que superaron el tope, cada una con su razón, y audita como system', async () => {
    const w = iamWorld();
    w.sessions.sessions = [
      session({ userSessionId: 's-inactiva', jti: 'jti-i', lastAccessAt: new Date(Date.now() - 20 * MIN), startedAt: new Date(Date.now() - HOUR) }),
      session({ userSessionId: 's-vieja', jti: 'jti-v', lastAccessAt: new Date(), startedAt: new Date(Date.now() - 9 * HOUR) }),
      session({ userSessionId: 's-viva', jti: 'jti-ok' })
    ];
    await expect(new ExpireSessions(w).execute()).resolves.toEqual({ scanned: 2, closed: 2 });
    await settle();
    expect(w.sessions.get('s-inactiva')?.closeReason).toBe('inactivity_timeout');
    expect(w.sessions.get('s-vieja')?.closeReason).toBe('absolute_lifetime');
    expect(w.sessions.get('s-viva')?.status).toBe('active');
    expect(w.refreshTokens.revoked).toEqual(['jti-i', 'jti-v']);
    expect(w.revocations.sessions).toEqual(['s-inactiva', 's-vieja']);
    expect(w.audit.entries.map(e => [e.action, e.actorId])).toEqual([
      ['SESSION_EXPIRED_BY_WORKER', 'system'],
      ['SESSION_ABSOLUTE_EXPIRED', 'system']
    ]);
  });

  it('si otra vía la cerró entre la lectura y el cierre, no la cuenta ni la audita', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session({ lastAccessAt: new Date(Date.now() - 20 * MIN) })];
    w.sessions.close = async () => 0;
    await expect(new ExpireSessions(w).execute()).resolves.toEqual({ scanned: 1, closed: 0 });
    expect(w.audit.entries).toHaveLength(0);
  });

  it('un error en una sesión no corta el barrido', async () => {
    const w = iamWorld();
    w.sessions.sessions = [
      session({ userSessionId: 's-a', lastAccessAt: new Date(Date.now() - 20 * MIN) }),
      session({ userSessionId: 's-b', lastAccessAt: new Date(Date.now() - 20 * MIN) })
    ];
    const close = w.sessions.close.bind(w.sessions);
    w.sessions.close = async (id, reason) => (id === 's-a' ? Promise.reject(new Error('db')) : close(id, reason));
    await expect(new ExpireSessions(w).execute()).resolves.toEqual({ scanned: 2, closed: 1 });
    expect(w.logger.lines.filter(l => l.level === 'error')).toEqual([
      { level: 'error', message: 'Error al cerrar sesión en worker de expiración', meta: { sessionId: 's-a', error: 'db' } }
    ]);
  });
});
