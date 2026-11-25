// Ciclo de vida de la sesión: refresh con rotación (gracia, blacklist, reuse attack, tope absoluto), logout, logout-all
// y cierre de sesiones propias, sobre dobles en memoria.
import { CloseOtherSessions, CloseOwnSession, Logout, LogoutAll, RefreshTokens } from './session-lifecycle.use-cases';
import { SessionControl } from './sessions';
import { IamUnauthorizedError, SessionClosedError, SessionNotFoundError } from '../../domain/errors';
import { CLIENT_ID, device, iamWorld, session, settle, user, type IamWorld } from '../../../../../tests/doubles/iam.doubles';

/** Un refresh vigente de la sesión s-1 (JTI guardado en Redis y fila activa). */
async function issuedRefresh(w: IamWorld, over: { startedAt?: Date } = {}) {
  w.sessions.sessions = [session({ userSessionId: 's-1', jti: 'jti-1', ...over })];
  await w.refreshTokens.save('jti-1', CLIENT_ID);
  return w.tokens.generateRefreshToken(CLIENT_ID, 'jti-1', 's-1');
}

describe('RefreshTokens', () => {
  it('rota: revoca el JTI viejo, emite el par nuevo con la misma sesión y abre la ventana de gracia', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w);
    const result = await new RefreshTokens(w).execute(refreshToken);
    await settle();

    expect(result).toEqual({ accessToken: `access.${CLIENT_ID}.s-1`, refreshToken: 'refresh.uuid-1', expiresIn: 900 });
    expect(w.refreshTokens.revoked).toEqual(['jti-1']);
    expect(w.refreshTokens.jtis.get('uuid-1')).toBe(CLIENT_ID);
    expect(w.refreshTokens.rotations.get('jti-1')).toEqual(result);
    expect(w.revocations.refreshTokens.has(refreshToken)).toBe(true);
    expect(w.revocations.rotations).toEqual([{ sessionId: 's-1', rotationTs: expect.any(Number) }]);
    expect(w.sessions.rotated).toEqual([{ sessionId: 's-1', jti: 'uuid-1' }]);
    expect(w.audit.find('TOKEN_REFRESHED')).toMatchObject({ details: { jti: 'jti-1', newJti: 'uuid-1' } });
  });

  it('dentro de la ventana de gracia devuelve el mismo par (refresh concurrente)', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w);
    const first = await new RefreshTokens(w).execute(refreshToken);
    const again = await new RefreshTokens(w).execute(refreshToken);
    expect(again).toEqual(first);
    expect(w.audit.actions().filter(a => a === 'TOKEN_REFRESHED')).toHaveLength(1);
  });

  it('un refresh en blacklist (logout) o anterior a un logout-all → sesión expirada', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w);
    w.revocations.refreshTokens.add(refreshToken);
    await expect(new RefreshTokens(w).execute(refreshToken)).rejects.toThrow(new SessionClosedError('La sesión ha expirado. Por favor inicia sesión nuevamente.'));

    w.revocations.refreshTokens.clear();
    w.revocations.invalidatedUsers.add(CLIENT_ID);
    await expect(new RefreshTokens(w).execute(refreshToken)).rejects.toThrow(SessionClosedError);
  });

  it('JTI ausente con Redis sano y la sesión activa → reuse attack: invalida todo y responde SESSION_COMPROMISED', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w);
    w.refreshTokens.jtis.clear();
    await expect(new RefreshTokens(w).execute(refreshToken)).rejects.toMatchObject({
      message: 'Sesión comprometida. Por favor inicia sesión nuevamente.',
      details: { code: 'SESSION_COMPROMISED' }
    });
    await settle();
    expect(w.audit.find('REFRESH_TOKEN_REUSE_ATTACK')).toMatchObject({ outcome: 'failure', details: { jti: 'jti-1' } });
    expect(w.revocations.invalidatedUsers.has(CLIENT_ID)).toBe(true);
  });

  it('JTI ausente porque la sesión ya se cerró legítimamente → 401 normal, sin invalidación global', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w);
    w.refreshTokens.jtis.clear();
    await w.sessions.close('s-1', 'logout');
    await expect(new RefreshTokens(w).execute(refreshToken)).rejects.toThrow(SessionClosedError);
    expect(w.audit.actions()).not.toContain('REFRESH_TOKEN_REUSE_ATTACK');
    expect(w.revocations.invalidatedUsers.size).toBe(0);
  });

  it('JTI ausente con Redis caído no es un robo: deja rotar (fail-open) y lo avisa', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w);
    w.refreshTokens.jtis.clear();
    w.cache.available = false;
    await expect(new RefreshTokens(w).execute(refreshToken)).resolves.toHaveProperty('accessToken');
    expect(w.logger.warnings()).toContain('Refresh sin verificación de JTI — Redis no disponible');
  });

  it('usuario inexistente o inactivo → 401 con SESSION_CLOSED', async () => {
    const w = iamWorld([user({ isActive: false })]);
    const refreshToken = await issuedRefresh(w);
    await expect(new RefreshTokens(w).execute(refreshToken)).rejects.toMatchObject({
      message: 'Usuario no encontrado o inactivo',
      details: { code: 'SESSION_CLOSED' }
    });
  });

  it('una sesión que superó las 8 horas se cierra y no se renueva', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w, { startedAt: new Date(Date.now() - 9 * 60 * 60 * 1000) });
    await expect(new RefreshTokens(w).execute(refreshToken)).rejects.toMatchObject({ details: { code: 'SESSION_ABSOLUTE_LIFETIME' } });
    await settle();
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'absolute_lifetime' });
    expect(w.revocations.sessions).toContain('s-1');
    expect(w.audit.find('SESSION_ABSOLUTE_EXPIRED')).toMatchObject({ entityId: 's-1', details: { limitHours: 8 } });
  });

  it('si el JTI nuevo no se guarda, el refresh falla (el viejo ya se revocó)', async () => {
    const w = iamWorld();
    const refreshToken = await issuedRefresh(w);
    w.refreshTokens.saveFails = true;
    await expect(new RefreshTokens(w).execute(refreshToken)).rejects.toThrow('Error al renovar la sesión. Por favor inicia sesión nuevamente.');
  });

  it('una firma inválida la rechaza el servicio de tokens', async () => {
    await expect(new RefreshTokens(iamWorld()).execute('basura')).rejects.toThrow(IamUnauthorizedError);
  });
});

describe('Logout', () => {
  it('cierra la sesión, blacklistea access y refresh, toca el dispositivo y audita', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session()];
    const result = await new Logout(w).execute(CLIENT_ID, 'fp-1', { accessToken: 'acc', tokenExp: 123, refreshToken: 'ref', sessionId: 's-1' });
    await settle();
    expect(result).toBeNull();
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'logout' });
    expect(w.revocations.accessTokens.has('acc')).toBe(true);
    expect(w.revocations.refreshTokens.has('ref')).toBe(true);
    expect(w.devices.seen).toEqual([{ userId: CLIENT_ID, fingerprintHash: 'fp-1' }]);
    expect(w.audit.find('LOGOUT')).toMatchObject({ details: { fingerprintHash: 'fp-1' } });
  });

  it('si Redis falla solo se loguea: el logout responde igual', async () => {
    const w = iamWorld();
    w.revocations.failing = true;
    await expect(new Logout(w).execute(CLIENT_ID, 'fp-1', { accessToken: 'acc', refreshToken: 'ref' })).resolves.toBeNull();
    await settle();
    expect(w.logger.warnings()).toEqual(
      expect.arrayContaining(['Error añadiendo access token a blacklist en logout', 'Error añadiendo refresh token a blacklist en logout'])
    );
  });
});

describe('LogoutAll', () => {
  it('invalida todos los tokens del usuario, cierra las sesiones, borra los dispositivos y avisa', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session({ userSessionId: 's-1' }), session({ userSessionId: 's-2', jti: 'jti-2' })];
    await new LogoutAll(w).execute(CLIENT_ID, { accessToken: 'acc', firstName: 'Ana' });
    await settle();
    expect(w.revocations.invalidatedUsers.has(CLIENT_ID)).toBe(true);
    expect(w.sessions.sessions.every(s => s.status === 'closed' && s.closeReason === 'logout_all')).toBe(true);
    expect(w.devices.deletedFor).toEqual([CLIENT_ID]);
    expect(w.audit.actions()).toEqual(['LOGOUT_ALL']);
    expect(w.notifier.sent).toEqual([{ type: 'LOGOUT_ALL', userId: CLIENT_ID, metadata: { nombre: 'Ana' } }]);
  });
});

describe('sesiones propias', () => {
  function setup() {
    const w = iamWorld();
    w.devices.devices = [device()];
    w.sessions.sessions = [
      session({ userSessionId: 's-actual', jti: 'jti-actual' }),
      session({ userSessionId: 's-otra', jti: 'jti-otra' }),
      session({ userSessionId: 's-ajena', jti: 'jti-ajena', userId: 'u-otro' })
    ];
    const control = new SessionControl(w);
    return { w, closeOwn: new CloseOwnSession(control), closeOthers: new CloseOtherSessions(control) };
  }

  it('cierra una sesión propia: la marca, revoca su JTI y la blacklistea', async () => {
    const { w, closeOwn } = setup();
    await expect(closeOwn.execute(CLIENT_ID, 's-otra', 's-actual')).resolves.toEqual({ sessionId: 's-otra', status: 'closed' });
    await settle();
    expect(w.sessions.get('s-otra')).toMatchObject({ status: 'closed', closeReason: 'closed_by_user' });
    expect(w.refreshTokens.revoked).toEqual(['jti-otra']);
    expect(w.revocations.sessions).toEqual(['s-otra']);
    expect(w.audit.find('SESSION_CLOSED_BY_USER')).toMatchObject({ entityId: 's-otra' });
  });

  it('la actual se cierra con logout; una ajena o inexistente es 404; una cerrada es 400', async () => {
    const { w, closeOwn } = setup();
    await expect(closeOwn.execute(CLIENT_ID, 's-actual', 's-actual')).rejects.toThrow('Para cerrar la sesión actual usa el endpoint de logout');
    await expect(closeOwn.execute(CLIENT_ID, 's-ajena', 's-actual')).rejects.toThrow(SessionNotFoundError);
    await expect(closeOwn.execute(CLIENT_ID, 'nada', 's-actual')).rejects.toThrow(SessionNotFoundError);
    await w.sessions.close('s-otra', 'logout');
    await expect(closeOwn.execute(CLIENT_ID, 's-otra', 's-actual')).rejects.toThrow('La sesión ya está cerrada');
  });

  it('cerrar las demás deja solo la actual y devuelve cuántas cerró', async () => {
    const { w, closeOthers } = setup();
    await expect(closeOthers.execute(CLIENT_ID, 's-actual')).resolves.toEqual({ closedCount: 1 });
    await settle();
    expect(w.sessions.get('s-actual')?.status).toBe('active');
    expect(w.sessions.get('s-otra')).toMatchObject({ status: 'closed', closeReason: 'logout_others' });
    expect(w.sessions.get('s-ajena')?.status).toBe('active');
    expect(w.refreshTokens.revoked).toEqual(['jti-otra']);
    expect(w.audit.find('LOGOUT_OTHERS')).toMatchObject({ details: { closedCount: 1 } });
  });

  it('sin otras sesiones responde 0 y no audita', async () => {
    const { w, closeOthers } = setup();
    await closeOthers.execute(CLIENT_ID, 's-actual');
    w.audit.entries.length = 0;
    await expect(closeOthers.execute(CLIENT_ID, 's-actual')).resolves.toEqual({ closedCount: 0 });
    expect(w.audit.entries).toHaveLength(0);
  });
});
