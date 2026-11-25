// Autenticación de cada request: token propio, firma HMAC mobile, dispositivo bloqueado, blacklist (con y sin Redis),
// inactividad de la sesión, 2FA obligatorio de los internos, RBAC por ruta, API keys y límite por IP del login.
import {
  AuthenticateRequest,
  AuthorizePermission,
  RequirePrivilegedMfa,
  ThrottleLoginByIp,
  VerifyExternalApiKey,
  VerifyRequestSignature,
  type AuthenticationInput
} from './authentication.use-cases';
import { PermissionResolver } from './rbac.use-cases';
import { DeviceBlockedError, IamForbiddenError, IamUnauthorizedError, MfaRequiredError, SessionClosedError } from '../../domain/errors';
import { admin, ADMIN_ID, CLIENT_ID, device, iamWorld, session, staff, STAFF_ID, user, type IamWorld } from '../../../../../tests/doubles/iam.doubles';

const SIGNATURE = { method: 'GET', path: '/client/api/v1/me' };

/** Un access token vigente de la sesión s-1 del cliente. */
async function setup(w: IamWorld = iamWorld()) {
  w.sessions.sessions = [session()];
  const accessToken = await w.tokens.generateAccessToken(user(), 's-1');
  const auth = new AuthenticateRequest({ ...w, verifySignature: new VerifyRequestSignature(w) });
  const input: AuthenticationInput = { accessToken, canal: 'web', requireRole: true, fingerprintHash: 'fp-1', path: '/me', signature: SIGNATURE };
  return { w, auth, input };
}

describe('AuthenticateRequest — token', () => {
  it('devuelve quién llama con los claims del token', async () => {
    const { auth, input } = await setup();
    await expect(auth.execute(input)).resolves.toMatchObject({
      sessionId: 's-1',
      userId: CLIENT_ID,
      roleId: 'role-cliente',
      roleName: 'CLIENTE',
      firstName: 'Ana',
      canal: 'web',
      tokenIat: expect.any(Number)
    });
  });

  it('sin userId es 401; sin rol (cuando se exige) es 403', async () => {
    const { w, auth, input } = await setup();
    w.tokens.access.set('sin-user', {});
    await expect(auth.execute({ ...input, accessToken: 'sin-user' })).rejects.toThrow(new IamUnauthorizedError('Token inválido'));
    w.tokens.access.set('sin-rol', { userId: CLIENT_ID, sessionId: 's-1' });
    await expect(auth.execute({ ...input, accessToken: 'sin-rol' })).rejects.toThrow(new IamForbiddenError('Token sin rol asignado'));
    await expect(auth.execute({ ...input, accessToken: 'sin-rol', requireRole: false })).resolves.toMatchObject({ roleName: null });
  });

  it('un token en blacklist, anterior al umbral de su sesión o a un logout-all → sesión cerrada', async () => {
    const { w, auth, input } = await setup();
    w.revocations.accessTokens.add(input.accessToken);
    await expect(auth.execute(input)).rejects.toThrow(SessionClosedError);
    w.revocations.accessTokens.clear();
    w.revocations.invalidatedSessions.add('s-1');
    await expect(auth.execute(input)).rejects.toThrow(SessionClosedError);
    w.revocations.invalidatedSessions.clear();
    w.revocations.invalidatedUsers.add(CLIENT_ID);
    await expect(auth.execute(input)).rejects.toThrow(SessionClosedError);
  });

  it('sin Redis valida la sesión contra la base (política A)', async () => {
    const { w, auth, input } = await setup();
    w.cache.available = false;
    w.revocations.accessTokens.add(input.accessToken);
    await expect(auth.execute(input)).resolves.toMatchObject({ userId: CLIENT_ID });
    await w.sessions.close('s-1', 'logout');
    await expect(auth.execute(input)).rejects.toThrow(SessionClosedError);
  });
});

describe('AuthenticateRequest — dispositivo', () => {
  it('un dispositivo en la blocklist es 403 con DEVICE_BLOCKED', async () => {
    const { w, auth, input } = await setup();
    await w.deviceBlocklist.block(CLIENT_ID, 'fp-1');
    await expect(auth.execute(input)).rejects.toMatchObject({ details: { code: 'DEVICE_BLOCKED' } });
  });

  it('sin Redis mira el estado del dispositivo en la base', async () => {
    const { w, auth, input } = await setup();
    w.cache.available = false;
    w.devices.devices = [device({ status: 'blocked' })];
    await expect(auth.execute(input)).rejects.toThrow(DeviceBlockedError);
  });

  it('sin huella no se revisa la blocklist (y se avisa)', async () => {
    const { w, auth, input } = await setup();
    await w.deviceBlocklist.block(CLIENT_ID, 'fp-1');
    await expect(auth.execute({ ...input, fingerprintHash: null })).resolves.toMatchObject({ userId: CLIENT_ID });
    expect(w.logger.warnings()).toContain('AuthMiddleware: fingerprintHash no disponible en res.locals, omitiendo check de blocklist');
  });
});

describe('AuthenticateRequest — firma mobile', () => {
  it('en producción el request mobile debe venir firmado', async () => {
    const w = iamWorld();
    w.policy.requireMobileSignature = true;
    const { auth, input } = await setup(w);
    await expect(auth.execute({ ...input, canal: 'mobile' })).rejects.toThrow('X-Timestamp header requerido');
    const timestamp = String(Date.now());
    const signed = { ...SIGNATURE, timestamp, deviceId: 'fp-1', signature: `sig(${timestamp}:GET:/client/api/v1/me:hmac-dev-1)` };
    await expect(auth.execute({ ...input, canal: 'mobile', signature: signed })).resolves.toMatchObject({ canal: 'mobile' });
    await expect(auth.execute({ ...input, canal: 'web' })).resolves.toMatchObject({ canal: 'web' });
  });
});

describe('AuthenticateRequest — después de autenticar', () => {
  it('deja la sesión en el contexto y renueva last_access_at con throttle', async () => {
    const { w, auth, input } = await setup();
    w.sessions.get('s-1')!.lastAccessAt = new Date(Date.now() - 2 * 60 * 1000);
    await auth.afterAuthenticated(await auth.execute(input));
    expect(w.operationSession.binds).toEqual([{ sessionId: 's-1', userId: CLIENT_ID }]);
    expect(w.sessions.touched).toEqual(['s-1']);

    w.sessions.get('s-1')!.lastAccessAt = new Date();
    await auth.afterAuthenticated(await auth.execute(input));
    expect(w.sessions.touched).toEqual(['s-1']);
  });

  it('más de 15 minutos sin actividad cierra la sesión (con el mensaje de cada tipo de usuario)', async () => {
    const { w, auth, input } = await setup();
    w.sessions.get('s-1')!.lastAccessAt = new Date(Date.now() - 16 * 60 * 1000);
    const caller = await auth.execute(input);
    await expect(auth.afterAuthenticated(caller)).rejects.toMatchObject({
      message: 'Sesión expirada por inactividad. Vuelve a iniciar sesión.',
      details: { code: 'SESSION_INACTIVITY' }
    });
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'inactivity_timeout' });

    w.sessions.sessions = [session({ lastAccessAt: new Date(Date.now() - 16 * 60 * 1000) })];
    await expect(auth.afterAuthenticated({ ...caller, roleName: 'ADMIN' })).rejects.toThrow('Sesión expirada por inactividad. Vuelve a iniciar sesión con 2FA.');
  });

  it('una sesión que ya no está activa es 401 SESSION_CLOSED; sin sessionId no se controla', async () => {
    const { w, auth, input } = await setup();
    const caller = await auth.execute(input);
    await w.sessions.close('s-1', 'logout');
    await expect(auth.afterAuthenticated(caller)).rejects.toMatchObject({ details: { code: 'SESSION_CLOSED' } });
    await expect(auth.afterAuthenticated({ ...caller, sessionId: null })).resolves.toBeUndefined();
  });

  it('clearSession deja el contexto anónimo', async () => {
    const { w, auth } = await setup();
    auth.clearSession();
    expect(w.operationSession.binds).toEqual([{ sessionId: null, userId: null }]);
  });
});

describe('VerifyRequestSignature', () => {
  function signed(over: Record<string, string> = {}) {
    const timestamp = over.timestamp ?? String(Date.now());
    return { method: 'POST', path: '/x', timestamp, deviceId: 'fp-1', signature: `sig(${timestamp}:POST:/x:hmac-dev-1)`, ...over };
  }

  it('acepta una firma válida dentro de la ventana de 10 s', async () => {
    await expect(new VerifyRequestSignature(iamWorld()).execute(signed())).resolves.toBeUndefined();
  });

  it('exige los tres headers', async () => {
    const verify = new VerifyRequestSignature(iamWorld());
    await expect(verify.execute({ ...signed(), timestamp: undefined })).rejects.toThrow('X-Timestamp header requerido');
    await expect(verify.execute({ ...signed(), signature: undefined })).rejects.toThrow('X-Signature header requerido');
    await expect(verify.execute({ ...signed(), deviceId: undefined })).rejects.toThrow('X-Device-Id header requerido');
  });

  it('rechaza un timestamp no numérico o fuera de la ventana', async () => {
    const verify = new VerifyRequestSignature(iamWorld());
    await expect(verify.execute(signed({ timestamp: 'ayer' }))).rejects.toThrow('Timestamp inválido');
    await expect(verify.execute(signed({ timestamp: String(Date.now() - 11_000) }))).rejects.toThrow(
      'Timestamp expirado. El request debe realizarse dentro de 10 segundos'
    );
  });

  it('rechaza un dispositivo desconocido o sin secreto', async () => {
    const w = iamWorld();
    const verify = new VerifyRequestSignature(w);
    await expect(verify.execute(signed({ deviceId: 'fp-x' }))).rejects.toThrow('Dispositivo no reconocido. Inicia sesión nuevamente.');
    w.devices.devices = [device({ hmacSecret: null })];
    await expect(verify.execute(signed())).rejects.toThrow('Dispositivo no reconocido. Inicia sesión nuevamente.');
  });

  it('rechaza otra firma, o una firma de otro path', async () => {
    const verify = new VerifyRequestSignature(iamWorld());
    await expect(verify.execute(signed({ signature: 'cualquiera' }))).rejects.toThrow('Firma de request inválida');
    await expect(verify.execute({ ...signed(), path: '/otro' })).rejects.toThrow('Firma de request inválida');
  });
});

describe('RequirePrivilegedMfa y AuthorizePermission', () => {
  function setupAuthz() {
    const w = iamWorld([admin(), staff({ totpEnabled: false, smsMfaEnabled: false }), user()]);
    const privilegedMfa = new RequirePrivilegedMfa(w);
    return { w, privilegedMfa, authorize: new AuthorizePermission({ ...w, permissions: new PermissionResolver(w), privilegedMfa }) };
  }

  it('un interno sin 2FA no opera (403 MFA_REQUIRED); un cliente no lo necesita', async () => {
    const { privilegedMfa } = setupAuthz();
    await expect(privilegedMfa.execute('AUDITOR', STAFF_ID, '/x')).rejects.toThrow(MfaRequiredError);
    await expect(privilegedMfa.execute('ADMIN', ADMIN_ID, '/x')).resolves.toBeUndefined();
    await expect(privilegedMfa.isMissing('CLIENTE', CLIENT_ID)).resolves.toBe(false);
    await expect(privilegedMfa.isMissing('ADMIN', null)).resolves.toBe(true);
  });

  it('exige el permiso del módulo y, para internos, el 2FA', async () => {
    const { authorize } = setupAuthz();
    const ask = (roleName: string | null, userId: string, action: string) =>
      authorize.execute({ roleName, userId, moduleName: 'internalUsers', action, path: '/x' });
    await expect(ask('ADMIN', ADMIN_ID, 'delete')).resolves.toBeUndefined();
    await expect(ask('AUDITOR', STAFF_ID, 'update')).rejects.toThrow('No tienes permisos para realizar esta acción');
    await expect(ask('AUDITOR', STAFF_ID, 'read')).rejects.toThrow(MfaRequiredError);
    await expect(ask('CLIENTE', CLIENT_ID, 'read')).rejects.toThrow(IamForbiddenError);
    await expect(ask(null, CLIENT_ID, 'read')).rejects.toThrow(new IamUnauthorizedError('Token sin rol asignado'));
  });
});

describe('VerifyExternalApiKey y ThrottleLoginByIp', () => {
  it('la API key se valida con el verificador', () => {
    const verify = new VerifyExternalApiKey(iamWorld());
    expect(verify.execute('key-ok')).toBe(true);
    expect(verify.execute('otra')).toBe(false);
    expect(verify.execute(undefined)).toBe(false);
  });

  it('una IP bloqueada es 429 con Retry-After; cada intento suma y al superar el límite bloquea', async () => {
    const w = iamWorld();
    const throttle = new ThrottleLoginByIp(w);
    await expect(throttle.execute('9.9.9.9')).resolves.toBeUndefined();
    expect(w.rateLimiter.ipHits).toEqual(['9.9.9.9']);

    w.rateLimiter.ipIncrement = 600;
    await expect(throttle.execute('9.9.9.9')).rejects.toMatchObject({
      message: 'Demasiados intentos desde esta IP. Intenta nuevamente en 10 minuto(s)',
      retryAfterSeconds: 600
    });

    w.rateLimiter.ipBlock = 90;
    await expect(throttle.execute('9.9.9.9')).rejects.toMatchObject({ retryAfterSeconds: 90 });
    expect(w.rateLimiter.ipHits).toHaveLength(2);
  });
});
