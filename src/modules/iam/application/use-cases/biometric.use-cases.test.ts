// Biometría (WebAuthn, ES256): registro desde un dispositivo trusted, login con huella (challenge de un solo uso,
// sign_count anti-replay, firma) y gestión de las credenciales.
import {
  DeleteBiometricCredential,
  FinishBiometricLogin,
  FinishBiometricRegistration,
  ListBiometricCredentials,
  StartBiometricLogin,
  StartBiometricRegistration
} from './biometric.use-cases';
import { IamConflictError, IamForbiddenError, IamUnauthorizedError, InactiveAccountError, InvalidBiometricChallengeError } from '../../domain/errors';
import {
  ACTIVE_POLICY,
  CLIENT_DOC,
  CLIENT_ID,
  credential,
  device,
  iamWorld,
  loginSteps,
  session,
  settle,
  user,
  type IamWorld
} from '../../../../../tests/doubles/iam.doubles';

const REGISTRATION = { credentialId: 'cred-nueva', publicKey: 'pk-nueva', challenge: 'reto-reg', signature: 'firma' };
const ASSERTION = { credentialId: 'cred-1', challenge: 'reto-login', signature: 'firma', signCount: 6 };
const CONTEXT = { ip: '1.1.1.1', userAgent: 'jest', fingerprintHash: 'fp-1' };

describe('StartBiometricRegistration', () => {
  it('solo desde un dispositivo trusted', async () => {
    const w = iamWorld();
    w.devices.devices = [device({ status: 'pending' })];
    await expect(new StartBiometricRegistration(w).execute(CLIENT_ID, 'fp-1')).rejects.toThrow(
      new IamForbiddenError('Solo puedes registrar una huella desde un dispositivo de confianza')
    );
  });

  it('un dispositivo que ya tiene huella es 409', async () => {
    const w = iamWorld();
    w.biometricCredentials.credentials = [credential()];
    await expect(new StartBiometricRegistration(w).execute(CLIENT_ID, 'fp-1')).rejects.toThrow(IamConflictError);
  });

  it('genera el challenge de registro, lo guarda y audita', async () => {
    const w = iamWorld();
    await expect(new StartBiometricRegistration(w).execute(CLIENT_ID, 'fp-1')).resolves.toEqual({ challenge: 'challenge-1', deviceId: 'dev-1', algorithm: -7 });
    expect(w.biometricChallenges.challenges[0]).toMatchObject({ userId: CLIENT_ID, challenge: 'challenge-1', type: 'registration' });
    expect(w.audit.find('BIOMETRIC_REGISTER_START')).toMatchObject({ entityId: 'dev-1' });
  });
});

describe('FinishBiometricRegistration', () => {
  function setup() {
    const w = iamWorld();
    w.biometricChallenges.add('reto-reg', CLIENT_ID, 'registration');
    return { w, finish: new FinishBiometricRegistration(w) };
  }

  it('el challenge debe existir, ser del usuario y de registro', async () => {
    const { w, finish } = setup();
    await expect(finish.execute({ ...REGISTRATION, challenge: 'otro' }, CLIENT_ID, 'fp-1')).rejects.toThrow(InvalidBiometricChallengeError);
    w.biometricChallenges.add('ajeno', 'u-otro', 'registration');
    await expect(finish.execute({ ...REGISTRATION, challenge: 'ajeno' }, CLIENT_ID, 'fp-1')).rejects.toThrow('El challenge no pertenece a este usuario');
    w.biometricChallenges.add('de-login', CLIENT_ID, 'authentication');
    await expect(finish.execute({ ...REGISTRATION, challenge: 'de-login' }, CLIENT_ID, 'fp-1')).rejects.toThrow('Tipo de challenge incorrecto');
  });

  it('si otro request ya consumió el challenge (replay) no verifica la firma', async () => {
    const { w, finish } = setup();
    w.biometricChallenges.lostRace = true;
    await expect(finish.execute(REGISTRATION, CLIENT_ID, 'fp-1')).rejects.toThrow(InvalidBiometricChallengeError);
    expect(w.signatures.checked).toHaveLength(0);
  });

  it('una firma inválida es 401 y se audita (el challenge ya quedó usado)', async () => {
    const { w, finish } = setup();
    w.signatures.valid = false;
    await expect(finish.execute(REGISTRATION, CLIENT_ID, 'fp-1')).rejects.toThrow(new IamUnauthorizedError('Firma biométrica inválida'));
    expect(w.biometricChallenges.challenges[0]!.used).toBe(true);
    expect(w.audit.find('BIOMETRIC_REGISTER_INVALID_SIGNATURE')).toMatchObject({ outcome: 'failure' });
  });

  it('un credentialId ya registrado es 409', async () => {
    const { w, finish } = setup();
    w.biometricCredentials.credentials = [credential({ credentialId: 'cred-nueva', userTrustedDeviceId: 'otro' })];
    await expect(finish.execute(REGISTRATION, CLIENT_ID, 'fp-1')).rejects.toThrow('Esta credencial biométrica ya está registrada');
  });

  it('guarda la credencial con sign_count 0, audita y avisa', async () => {
    const { w, finish } = setup();
    const result = await finish.execute(REGISTRATION, CLIENT_ID, 'fp-1');
    await settle();
    expect(w.signatures.checked).toEqual([{ publicKey: 'pk-nueva', challenge: 'reto-reg', signature: 'firma' }]);
    expect(w.biometricCredentials.credentials[0]).toMatchObject({ userId: CLIENT_ID, userTrustedDeviceId: 'dev-1', credentialId: 'cred-nueva', signCount: 0 });
    expect(result).toMatchObject({ biometricCredentialId: 'bio-1', credentialId: 'cred-nueva', deviceId: 'dev-1' });
    expect(w.audit.find('BIOMETRIC_REGISTER_SUCCESS')).toMatchObject({ entityId: 'bio-1' });
    expect(w.notifier.sent).toEqual([
      {
        type: 'BIOMETRIC_CREDENTIAL_REGISTERED',
        userId: CLIENT_ID,
        relatedEntity: { type: 'BiometricCredential', id: 'bio-1' },
        metadata: { nombre: 'Ana', logoUrl: 'https://cdn.test/logo.png' }
      }
    ]);
  });
});

describe('StartBiometricLogin', () => {
  it('documento desconocido 401; cuenta inactiva 403', async () => {
    const w = iamWorld([user({ isActive: false })]);
    await expect(new StartBiometricLogin(w).execute({ nationalId: 'NADIE' })).rejects.toThrow('Credenciales inválidas');
    await expect(new StartBiometricLogin(w).execute({ nationalId: CLIENT_DOC })).rejects.toThrow(InactiveAccountError);
  });

  it('crea un challenge de autenticación y audita', async () => {
    const w = iamWorld();
    await expect(new StartBiometricLogin(w).execute({ nationalId: CLIENT_DOC })).resolves.toEqual({ challenge: 'challenge-1', userId: CLIENT_ID });
    expect(w.biometricChallenges.challenges[0]).toMatchObject({ type: 'authentication', userId: CLIENT_ID });
    expect(w.audit.actions()).toEqual(['BIOMETRIC_LOGIN_START']);
  });
});

describe('FinishBiometricLogin', () => {
  function setup(w: IamWorld = iamWorld()) {
    w.biometricCredentials.credentials = [credential()];
    w.biometricChallenges.add('reto-login', CLIENT_ID, 'authentication');
    const { policyGate, sessionControl, sessionIssuer } = loginSteps(w);
    return { w, finish: new FinishBiometricLogin({ ...w, policyGate, sessionControl, sessionIssuer }) };
  }

  it('credencial desconocida es 401', async () => {
    const { finish } = setup();
    await expect(finish.execute({ ...ASSERTION, credentialId: 'nada' }, CONTEXT)).rejects.toThrow('Credencial biométrica no encontrada');
  });

  it('un sign_count que no crece es un replay: 401 y evento forense', async () => {
    const { w, finish } = setup();
    await expect(finish.execute({ ...ASSERTION, signCount: 5 }, CONTEXT)).rejects.toThrow('Sign count inválido — posible ataque de replay');
    expect(w.audit.find('BIOMETRIC_LOGIN_REPLAY_ATTACK')).toMatchObject({ outcome: 'failure', details: { signCount: 5 } });
    expect(w.signatures.checked).toHaveLength(0);
  });

  it('una firma inválida es 401 y se audita', async () => {
    const { w, finish } = setup();
    w.signatures.valid = false;
    await expect(finish.execute(ASSERTION, CONTEXT)).rejects.toThrow('Firma biométrica inválida');
    expect(w.audit.actions()).toContain('BIOMETRIC_LOGIN_INVALID_SIGNATURE');
  });

  it('el challenge debe ser de autenticación y no estar consumido', async () => {
    const { w, finish } = setup();
    w.biometricChallenges.add('de-registro', CLIENT_ID, 'registration');
    await expect(finish.execute({ ...ASSERTION, challenge: 'de-registro' }, CONTEXT)).rejects.toThrow('Tipo de challenge incorrecto');
    w.biometricChallenges.lostRace = true;
    await expect(finish.execute(ASSERTION, CONTEXT)).rejects.toThrow(InvalidBiometricChallengeError);
  });

  it('usuario inexistente 401 o inactivo 403 (tras validar el challenge)', async () => {
    const { finish } = setup(iamWorld([user({ isActive: false })]));
    await expect(finish.execute(ASSERTION, CONTEXT)).rejects.toThrow(InactiveAccountError);
    const { finish: sinUsuario } = setup(iamWorld([]));
    await expect(sinUsuario.execute(ASSERTION, CONTEXT)).rejects.toThrow('Usuario no encontrado');
  });

  it('con la política pendiente responde "política pendiente" con la acción biométrica', async () => {
    const w = iamWorld();
    w.privacyPolicies.active = ACTIVE_POLICY;
    const { finish } = setup(w);
    await expect(finish.execute(ASSERTION, CONTEXT)).resolves.toMatchObject({ requiresPolicyAcceptance: true });
    expect(w.audit.actions()).toContain('BIOMETRIC_LOGIN_BLOCKED_POLICY_UPDATE');
  });

  it('el dispositivo de la credencial debe seguir siendo trusted', async () => {
    const w = iamWorld();
    w.devices.devices = [device({ status: 'blocked' })];
    const { finish } = setup(w);
    await expect(finish.execute(ASSERTION, CONTEXT)).rejects.toThrow('El dispositivo asociado a esta credencial ya no es de confianza');
  });

  it('emite tokens con el secreto HMAC, cierra la sesión previa del dispositivo y registra el login', async () => {
    const w = iamWorld();
    w.sessions.sessions = [session({ userSessionId: 's-vieja', deviceId: 'dev-1' })];
    const { finish } = setup(w);
    const result = await finish.execute(ASSERTION, CONTEXT);
    await settle();
    expect(result).toMatchObject({ deviceId: 'dev-1', hmacSecret: 'hmac-dev-1', tokens: { expiresIn: 900 } });
    expect(w.sessions.get('s-vieja')?.closeReason).toBe('reauth_same_device');
    expect(w.biometricCredentials.logins).toEqual([{ credentialId: 'cred-1', signCount: 6 }]);
    expect(w.devices.seen).toEqual([{ userId: CLIENT_ID, fingerprintHash: 'fp-1' }]);
    expect(w.loginAttempts.attempts[0]).toMatchObject({ success: true, nationalId: 'user_ana', originSessionId: 'uuid-1' });
    expect(w.audit.find('BIOMETRIC_LOGIN_SUCCESS')).toMatchObject({ entityId: 'cred-1', details: { deviceId: 'dev-1' } });
  });
});

describe('gestión de credenciales', () => {
  it('lista las activas del usuario y audita el conteo', async () => {
    const w = iamWorld();
    w.biometricCredentials.credentials = [credential(), credential({ userBiometricCredentialId: 'bio-2', isActive: false })];
    const result = await new ListBiometricCredentials(w).execute(CLIENT_ID);
    expect(result.total).toBe(1);
    expect(w.audit.find('BIOMETRIC_CREDENTIALS_VIEWED')).toMatchObject({ details: { count: 1 } });
  });

  it('eliminar desactiva la propia; una ajena es 404', async () => {
    const w = iamWorld();
    w.biometricCredentials.credentials = [credential(), credential({ userBiometricCredentialId: 'bio-ajena', userId: 'u-otro' })];
    await expect(new DeleteBiometricCredential(w).execute(CLIENT_ID, 'bio-1')).resolves.toBeNull();
    expect(w.biometricCredentials.credentials[0]!.isActive).toBe(false);
    expect(w.audit.find('BIOMETRIC_CREDENTIAL_DELETED')).toMatchObject({ entityId: 'bio-1' });
    await expect(new DeleteBiometricCredential(w).execute(CLIENT_ID, 'bio-ajena')).rejects.toThrow('Credencial biométrica no encontrada');
  });
});
