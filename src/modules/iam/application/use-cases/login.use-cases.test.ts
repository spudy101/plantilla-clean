// Login por contraseña y segundo factor (TOTP / SMS), con sus pasos compartidos (política, dispositivo, emisión de la
// sesión y límite de sesiones), sobre dobles en memoria de todos los puertos.
import { Login, VerifyMfaLogin } from './login.use-cases';
import { IamForbiddenError, IamInvalidInputError, IamRateLimitedError, IamUnauthorizedError, InactiveAccountError } from '../../domain/errors';
import {
  ACTIVE_POLICY,
  CLIENT_DOC,
  CLIENT_ID,
  device,
  iamWorld,
  loginSteps,
  session,
  settle,
  staff,
  TOTP_SECRET,
  user,
  VALID_TOTP,
  type IamWorld
} from '../../../../../tests/doubles/iam.doubles';

const PASSWORD = 'Correcta#2026';
const CONTEXT = { ip: '1.1.1.1', userAgent: 'jest', fingerprintHash: 'fp-1', serverContext: 'client' };

function setup(w: IamWorld = iamWorld()) {
  const deps = { ...w, ...loginSteps(w) };
  return { w, login: new Login(deps), verifyMfa: new VerifyMfaLogin(deps) };
}

describe('Login — prechequeos', () => {
  it('cuenta bloqueada en Redis → 429 sin mirar la contraseña', async () => {
    const { w, login } = setup();
    w.rateLimiter.accountBlock = 120;
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT)).rejects.toMatchObject({
      message: 'Cuenta bloqueada temporalmente. Intenta nuevamente en 2 minuto(s)',
      retryAfterSeconds: 120
    });
    expect(w.loginAttempts.attempts).toHaveLength(0);
  });

  it('sin Redis, el bloqueo de respaldo en la base también corta', async () => {
    const { w, login } = setup();
    w.loginAttempts.block = { blocked: true, blockedUntil: new Date(), remainingMinutes: 3 };
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT)).rejects.toMatchObject({
      message: 'Cuenta bloqueada temporalmente. Intenta nuevamente en 3 minuto(s)',
      retryAfterSeconds: 180
    });
  });

  it('documento desconocido → credenciales inválidas; cuenta inactiva → 403', async () => {
    const { w, login } = setup(iamWorld([user({ isActive: false })]));
    await expect(login.execute({ nationalId: 'NADIE', password: PASSWORD }, CONTEXT)).rejects.toThrow('Credenciales invalidas');
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT)).rejects.toThrow(InactiveAccountError);
    expect(w.sessions.sessions).toHaveLength(0);
  });

  it('un cliente no entra al portal admin', async () => {
    const { login } = setup();
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, { ...CONTEXT, serverContext: 'admin' })).rejects.toThrow(IamForbiddenError);
  });
});

describe('Login — contraseña incorrecta', () => {
  it('registra el intento fallido, audita LOGIN_FAILED y responde 400', async () => {
    const { w, login } = setup();
    await expect(login.execute({ nationalId: CLIENT_DOC, password: 'mala' }, CONTEXT)).rejects.toThrow(new IamInvalidInputError('Contraseña incorrecta'));
    expect(w.loginAttempts.attempts).toEqual([
      expect.objectContaining({ userId: CLIENT_ID, usernameAttempt: 'user_ana', success: false, failureReason: 'Contrasena invalida', deviceFingerprint: 'fp-1' })
    ]);
    expect(w.rateLimiter.failures).toEqual([CLIENT_DOC]);
    expect(w.audit.find('LOGIN_FAILED')).toMatchObject({ outcome: 'failure', details: { blocked: false } });
  });

  it('al llegar al tope bloquea la cuenta (429), audita ACCOUNT_BLOCKED y avisa al usuario', async () => {
    const { w, login } = setup();
    w.rateLimiter.accountFailure = 900;
    const error = await login.execute({ nationalId: CLIENT_DOC, password: 'mala' }, CONTEXT).catch(e => e);
    expect(error).toBeInstanceOf(IamRateLimitedError);
    expect(error.message).toBe('Cuenta bloqueada por 15 minutos debido a múltiples intentos fallidos');
    expect(w.audit.actions()).toEqual(['LOGIN_FAILED', 'ACCOUNT_BLOCKED']);
    await settle();
    expect(w.notifier.sent).toEqual([
      { type: 'ACCOUNT_BLOCKED', userId: CLIENT_ID, metadata: { nombre: 'Ana', intentosFallidos: 5, minutosBloqueo: 15 } }
    ]);
  });
});

describe('Login — política de privacidad', () => {
  it('con otra versión vigente y sin aceptar, responde "política pendiente" sin emitir tokens', async () => {
    const { w, login } = setup();
    w.privacyPolicies.active = ACTIVE_POLICY;
    const result = await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT);
    expect(result).toMatchObject({ requiresPolicyAcceptance: true, policy: { currentVersion: '1.0', newVersion: '2.0' } });
    expect(w.audit.find('LOGIN_BLOCKED_POLICY_UPDATE')).toMatchObject({ outcome: 'failure', details: { userVersion: '1.0', activeVersion: '2.0' } });
    expect(w.sessions.sessions).toHaveLength(0);
  });

  it('con acceptPolicy registra la versión y el consentimiento y sigue el login', async () => {
    const { w, login } = setup();
    w.privacyPolicies.active = ACTIVE_POLICY;
    const result = await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD, acceptPolicy: true }, CONTEXT);
    expect(result).toHaveProperty('tokens');
    expect(w.users.updates[0]!.changes).toMatchObject({ privacyPolicyVersion: '2.0', privacyPolicyAcceptedIp: '1.1.1.1' });
    expect(w.consents.granted).toEqual([{ kind: 'PRIVACY_POLICY', userId: CLIENT_ID, privacyPolicyId: 'pol-2', ip: '1.1.1.1' }]);
    expect(w.audit.actions()).toContain('PRIVACY_POLICY_ACCEPTED');
  });

  it('si el consentimiento falla, solo se loguea (best-effort) y el login sigue', async () => {
    const { w, login } = setup();
    w.privacyPolicies.active = ACTIVE_POLICY;
    w.consents.failWith = new Error('legal caído');
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD, acceptPolicy: true }, CONTEXT)).resolves.toHaveProperty('tokens');
    expect(w.logger.warnings()).toContain('auth-login: no se pudo registrar user_consent de privacy policy');
  });

  it('los internos no están sujetos a la política de clientes', async () => {
    const { w, login } = setup(iamWorld([staff({ privacyPolicyVersion: null })]));
    w.privacyPolicies.active = ACTIVE_POLICY;
    w.devices.devices = [device({ userId: 'u-staff' })];
    const result = await login.execute({ nationalId: 'LAURA0001', password: PASSWORD }, { ...CONTEXT, serverContext: 'admin' });
    expect(result).toHaveProperty('tokens');
  });
});

describe('Login — sin MFA', () => {
  it('emite tokens, crea la sesión del dispositivo, registra el intento y audita LOGIN_SUCCESS', async () => {
    const { w, login } = setup();
    const result = await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT);
    await settle();

    const created = w.sessions.sessions[0]!;
    expect(created).toMatchObject({ userId: CLIENT_ID, deviceId: 'dev-1', ipAddress: '1.1.1.1', status: 'active' });
    expect(result).toMatchObject({
      deviceId: 'dev-1',
      tokens: { accessToken: `access.${CLIENT_ID}.${created.userSessionId}`, refreshToken: `refresh.${created.jti}`, expiresIn: 900 }
    });
    expect(result).not.toHaveProperty('hmacSecret');
    expect(w.refreshTokens.jtis.get(created.jti)).toBe(CLIENT_ID);
    expect(w.loginAttempts.attempts[0]).toMatchObject({ success: true, originSessionId: created.userSessionId });
    expect(w.rateLimiter.resets).toEqual([CLIENT_DOC]);
    expect(w.revocations.cleared).toEqual([CLIENT_ID]);
    expect(w.devices.seen).toEqual([{ userId: CLIENT_ID, fingerprintHash: 'fp-1' }]);
    expect(w.audit.find('LOGIN_SUCCESS')).toMatchObject({ details: { nationalId: CLIENT_DOC, deviceId: 'dev-1' } });
  });

  it('mobile recibe el secreto HMAC del dispositivo y registra el push token', async () => {
    const { w, login } = setup();
    const result = await login.execute(
      { nationalId: CLIENT_DOC, password: PASSWORD },
      { ...CONTEXT, clientType: 'mobile', pushToken: 'fcm-1', pushPlatform: 'android', pushDeviceId: 'phone-1' }
    );
    await settle();
    expect(result).toMatchObject({ hmacSecret: 'hmac-dev-1' });
    expect(w.pushDevices.registered).toEqual([{ userId: CLIENT_ID, token: 'fcm-1', platform: 'android', deviceId: 'phone-1' }]);
  });

  it('cierra la sesión previa del mismo dispositivo antes de abrir la nueva', async () => {
    const { w, login } = setup();
    w.sessions.sessions = [session({ userSessionId: 's-vieja', jti: 'jti-vieja', deviceId: 'dev-1' })];
    await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT);
    await settle();
    expect(w.sessions.get('s-vieja')).toMatchObject({ status: 'closed', closeReason: 'reauth_same_device' });
    expect(w.refreshTokens.revoked).toContain('jti-vieja');
    expect(w.revocations.sessions).toContain('s-vieja');
    expect(w.audit.find('PREVIOUS_DEVICE_SESSIONS_CLOSED')).toMatchObject({ details: { closedCount: 1 } });
  });

  it('al alcanzar el límite de sesiones cierra la más antigua', async () => {
    const { w, login } = setup();
    const hour = 60 * 60 * 1000;
    w.sessions.sessions = [
      session({ userSessionId: 's-a', jti: 'jti-a', deviceId: 'otro-a', startedAt: new Date(Date.now() - 3 * hour) }),
      session({ userSessionId: 's-b', jti: 'jti-b', deviceId: 'otro-b', startedAt: new Date(Date.now() - 2 * hour) }),
      session({ userSessionId: 's-c', jti: 'jti-c', deviceId: 'otro-c', startedAt: new Date(Date.now() - hour) })
    ];
    await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT);
    expect(w.sessions.get('s-a')).toMatchObject({ status: 'closed', closeReason: 'session_limit' });
    expect(w.sessions.get('s-b')?.status).toBe('active');
    expect(w.audit.find('SESSION_LIMIT_ENFORCED')).toMatchObject({ entityId: 's-a', details: { activeCount: 3 } });
  });

  it('si el JTI no se guarda en Redis avisa, pero no corta el login', async () => {
    const { w, login } = setup();
    w.refreshTokens.saveFails = true;
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT)).resolves.toHaveProperty('tokens');
    expect(w.logger.warnings()).toContain('No se pudo guardar JTI de refresh token en login');
  });
});

describe('Login — dispositivo', () => {
  it('sin huella no se puede identificar el dispositivo', async () => {
    const { login } = setup();
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, { ...CONTEXT, fingerprintHash: null })).rejects.toThrow(
      'No se pudo identificar el dispositivo'
    );
  });

  it('un dispositivo bloqueado no inicia sesión y queda el evento forense', async () => {
    const { w, login } = setup();
    w.devices.devices = [device({ status: 'blocked' })];
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT)).rejects.toMatchObject({
      message: 'Este dispositivo ha sido bloqueado. Desbloquéalo desde otro dispositivo de confianza.',
      details: null
    });
    expect(w.audit.find('LOGIN_BLOCKED_DEVICE')).toMatchObject({ entityId: 'dev-1', outcome: 'failure' });
  });

  it('el primer dispositivo del usuario entra como trusted, sin aviso', async () => {
    const { w, login } = setup();
    w.devices.devices = [];
    const result = await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, { ...CONTEXT, fingerprintHash: 'fp-nueva' });
    await settle();
    expect(w.devices.created[0]).toMatchObject({ status: 'trusted', fingerprintHash: 'fp-nueva', deviceName: 'Firefox en Linux', city: 'Bogotá' });
    expect(result).toMatchObject({ deviceId: 'dev-1' });
    expect(w.audit.actions()).toContain('TRUSTED_DEVICE_ADDED_FIRST');
    expect(w.notifier.sent).toHaveLength(0);
  });

  it('un dispositivo nuevo, habiendo otro trusted, entra como pending y avisa al usuario', async () => {
    const { w, login } = setup();
    await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, { ...CONTEXT, fingerprintHash: 'fp-nueva' });
    await settle();
    expect(w.devices.created[0]).toMatchObject({ status: 'pending', fingerprintHash: 'fp-nueva' });
    expect(w.audit.find('TRUSTED_DEVICE_PENDING')).toMatchObject({ entityId: 'dev-2' });
    expect(w.notifier.sent).toEqual([
      expect.objectContaining({
        type: 'NUEVO_DISPOSITIVO_DETECTADO',
        userId: CLIENT_ID,
        metadata: expect.objectContaining({ nombre: 'Ana', email: 'ana@correo.co', browser: 'Firefox', ciudad: 'Bogotá', deviceName: 'Firefox en Linux' })
      })
    ]);
  });
});

describe('Login — segundo factor', () => {
  it('con TOTP preferido responde el reto con el token que prueba la contraseña', async () => {
    const { w, login } = setup(iamWorld([user({ preferredMfaMethod: 'totp', totpEnabled: true, totpSecret: `enc(${TOTP_SECRET})` })]));
    const result = await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT);
    expect(result).toEqual({ requiresMFA: true, challengeType: 'SOFTWARE_TOKEN_MFA', preferredMfaMethod: 'totp', username: 'user_ana', session: `mfa.${CLIENT_ID}` });
    expect(w.audit.find('MFA_REQUIRED')).toMatchObject({ details: { challengeType: 'SOFTWARE_TOKEN_MFA' } });
    expect(w.sessions.sessions).toHaveLength(0);
  });

  it('con SMS preferido crea el código, lo manda en segundo plano y responde el reto', async () => {
    const { w, login } = setup(iamWorld([user({ preferredMfaMethod: 'sms', smsMfaEnabled: true })]));
    const result = await login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT);
    await settle();
    expect(result).toEqual({ requiresMFA: true, challengeType: 'SMS_OTP', preferredMfaMethod: 'sms', username: 'user_ana', session: 'vc-1' });
    expect(w.verificationCodes.codes[0]).toMatchObject({ kind: 'phone', value: '3001234567', code: '654321' });
    expect(w.sms.sent).toEqual([
      { phoneNumber: '+573001234567', message: 'Tu código de verificación es 654321. Vence en 15 minutos.', userId: CLIENT_ID, purpose: 'mfa_login' }
    ]);
  });

  it('con proveedores simulados el código SMS es siempre 123456', async () => {
    const w = iamWorld([user({ preferredMfaMethod: 'sms', smsMfaEnabled: true })]);
    w.policy.mockOtpCodes = true;
    await setup(w).login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT);
    expect(w.verificationCodes.codes[0]!.code).toBe('123456');
  });

  it('el reto SMS respeta la espera entre códigos (429) y exige teléfono', async () => {
    const w = iamWorld([user({ preferredMfaMethod: 'sms', smsMfaEnabled: true })]);
    w.verificationCodes.waitSeconds = 30;
    const { login } = setup(w);
    await expect(login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT)).rejects.toMatchObject({
      message: 'Debes esperar 30 segundos antes de solicitar un nuevo código SMS',
      retryAfterSeconds: 30
    });

    const sinTelefono = user({ preferredMfaMethod: 'sms' });
    sinTelefono.person = { ...sinTelefono.person!, contact: { ...sinTelefono.person!.contact!, phonePrimary: null } };
    await expect(setup(iamWorld([sinTelefono])).login.execute({ nationalId: CLIENT_DOC, password: PASSWORD }, CONTEXT)).rejects.toThrow(
      'No tienes número de teléfono registrado para SMS MFA'
    );
  });
});

describe('VerifyMfaLogin', () => {
  const totpUser = () => iamWorld([user({ preferredMfaMethod: 'totp', totpEnabled: true, totpSecret: `enc(${TOTP_SECRET})` })]);

  it('TOTP válido con el reto de este usuario completa el login', async () => {
    const { w, verifyMfa } = setup(totpUser());
    const result = await verifyMfa.execute({ nationalId: CLIENT_DOC, totpCode: VALID_TOTP, session: `mfa.${CLIENT_ID}` }, CONTEXT);
    expect(result).toHaveProperty('tokens');
    expect(w.audit.actions()).toContain('LOGIN_SUCCESS');
  });

  it('sin reto, o con el reto de otro usuario, es 401 (no se salta la contraseña)', async () => {
    const { verifyMfa } = setup(totpUser());
    await expect(verifyMfa.execute({ nationalId: CLIENT_DOC, totpCode: VALID_TOTP }, CONTEXT)).rejects.toThrow(
      new IamUnauthorizedError('Falta el token de reto MFA. Vuelve a iniciar sesión.')
    );
    await expect(verifyMfa.execute({ nationalId: CLIENT_DOC, totpCode: VALID_TOTP, session: 'mfa.otro' }, CONTEXT)).rejects.toThrow(
      'El reto MFA no corresponde a este usuario. Vuelve a iniciar sesión.'
    );
  });

  it('TOTP incorrecto registra el intento, audita MFA_FAILED y responde 400', async () => {
    const { w, verifyMfa } = setup(totpUser());
    await expect(verifyMfa.execute({ nationalId: CLIENT_DOC, totpCode: '000000', session: `mfa.${CLIENT_ID}` }, CONTEXT)).rejects.toThrow(
      'Código TOTP incorrecto'
    );
    expect(w.loginAttempts.attempts[0]).toMatchObject({ success: false, failureReason: 'Codigo TOTP incorrecto' });
    expect(w.audit.find('MFA_FAILED')).toMatchObject({ outcome: 'failure' });
    expect(w.sessions.sessions).toHaveLength(0);
  });

  it('SMS correcto marca el código verificado y completa el login', async () => {
    const w = iamWorld([user({ preferredMfaMethod: 'sms', smsMfaEnabled: true })]);
    w.verificationCodes.add('phone', '3001234567', '111222');
    const { verifyMfa } = setup(w);
    const result = await verifyMfa.execute({ nationalId: CLIENT_DOC, smsCode: '111222' }, CONTEXT);
    expect(result).toHaveProperty('tokens');
    expect(w.verificationCodes.codes[0]!.verifiedAt).not.toBeNull();
  });

  it('SMS incorrecto suma un intento y dice cuántos quedan; agotados es 403', async () => {
    const w = iamWorld([user({ preferredMfaMethod: 'sms', smsMfaEnabled: true })]);
    w.verificationCodes.add('phone', '3001234567', '111222', 1);
    const { verifyMfa } = setup(w);
    await expect(verifyMfa.execute({ nationalId: CLIENT_DOC, smsCode: '999999' }, CONTEXT)).rejects.toThrow('Código SMS incorrecto. Te quedan 3 intento(s)');
    expect(w.verificationCodes.codes[0]!.attempts).toBe(2);
    expect(w.audit.find('MFA_FAILED')).toMatchObject({ details: { reason: 'Codigo SMS incorrecto' } });

    w.verificationCodes.codes[0]!.attempts = 5;
    await expect(verifyMfa.execute({ nationalId: CLIENT_DOC, smsCode: '111222' }, CONTEXT)).rejects.toThrow(IamForbiddenError);
  });

  it('SMS sin código, o sin código vigente, es 400', async () => {
    const { verifyMfa } = setup(iamWorld([user({ preferredMfaMethod: 'sms', smsMfaEnabled: true })]));
    await expect(verifyMfa.execute({ nationalId: CLIENT_DOC }, CONTEXT)).rejects.toThrow('Falta el código SMS');
    await expect(verifyMfa.execute({ nationalId: CLIENT_DOC, smsCode: '111222' }, CONTEXT)).rejects.toThrow('Código SMS inválido o expirado');
  });
});
