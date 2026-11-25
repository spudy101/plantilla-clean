// Registro de clientes (alta atómica + login automático) y reset de credenciales por enlace de un solo uso.
import { ConfirmCredentialReset, RegisterClient, RequestCredentialReset } from './registration.use-cases';
import { SessionIssuer } from './sessions';
import { IamConflictError, IamForbiddenError, IamInternalError, IamInvalidInputError, IamNotFoundError } from '../../domain/errors';
import { ACTIVE_POLICY, CLIENT_ID, iamWorld, ROLES, session, settle, user, type IamWorld } from '../../../../../tests/doubles/iam.doubles';

const EMAIL = 'nueva@correo.co';
const INPUT = {
  email: EMAIL,
  password: 'Nueva#2026x',
  firstName: 'Carla',
  lastName: 'Ruiz',
  nationalId: '99887766',
  documentTypeId: 'dt-cc'
};
const CONTEXT = { ip: '2.2.2.2', userAgent: 'jest' };

function setup() {
  const w = iamWorld([]);
  w.privacyPolicies.active = ACTIVE_POLICY;
  w.verificationCodes.verified.add(`email:${EMAIL}`);
  return { w, register: new RegisterClient({ ...w, sessionIssuer: new SessionIssuer(w) }) };
}

describe('RegisterClient — camino feliz', () => {
  it('crea persona, contacto y cuenta CLIENTE con la política vigente, emite la sesión y audita', async () => {
    const { w, register } = setup();
    const result = await register.execute(INPUT, CONTEXT);
    await settle();

    expect(w.holders.created).toEqual([
      {
        holder: expect.objectContaining({ firstName: 'Carla', nationalId: '99887766', documentTypeId: 'dt-cc', countryId: 'co', genderId: null }),
        contact: { email: EMAIL, emailVerifiedAt: expect.any(Date) }
      }
    ]);
    expect(w.users.created).toEqual([
      expect.objectContaining({
        username: 'user_uuid-1',
        authUsername: 'user_uuid-1',
        passwordHash: 'hash:Nueva#2026x',
        roleId: ROLES.CLIENTE.roleId,
        privacyPolicyVersion: '2.0',
        privacyPolicyAcceptedIp: '2.2.2.2'
      })
    ]);
    const created = w.users.users[0]!;
    expect(result).toMatchObject({ user: { userId: created.userId }, tokens: { accessToken: `access.${created.userId}.uuid-2`, expiresIn: 900 } });
    expect(w.sessions.sessions[0]).toMatchObject({ userId: created.userId, deviceId: null, ipAddress: '2.2.2.2' });
    expect(w.unitOfWork.runs).toBe(1);
    expect(w.audit.actions()).toEqual(['USER_REGISTERED']);
    expect(w.verificationCodes.consumed).toEqual([`email:${EMAIL}`]);
    expect(w.notifier.sent).toEqual([
      { type: 'BIENVENIDA', userId: created.userId, relatedEntity: null, metadata: { nombre: 'Carla', email: EMAIL, logoUrl: 'https://cdn.test/logo.png' } }
    ]);
  });

  it('la preferencia de notificación y los consentimientos van DENTRO de la transacción del alta', async () => {
    const { w, register } = setup();
    let insideTx = false;
    const run = w.unitOfWork.run.bind(w.unitOfWork);
    w.unitOfWork.run = async work => run(async () => {
      insideTx = true;
      const result = await work();
      insideTx = false;
      return result;
    });
    const seen: string[] = [];
    const grant = w.consents.grantPrivacyPolicy.bind(w.consents);
    w.consents.grantPrivacyPolicy = async input => (seen.push(`consent:${insideTx}`), grant(input));
    const createDefault = w.preferences.createDefault.bind(w.preferences);
    w.preferences.createDefault = async userId => (seen.push(`preferencia:${insideTx}`), createDefault(userId));

    await register.execute({ ...INPUT, comunicacionesComerciales: true }, CONTEXT);
    expect(seen).toEqual(['preferencia:true', 'consent:true']);
    expect(w.consents.granted.map(g => g.kind)).toEqual(['PRIVACY_POLICY', 'COMUNICACIONES_COMERCIALES']);
  });

  it('sin comunicaciones comerciales solo registra la política', async () => {
    const { w, register } = setup();
    await register.execute(INPUT, CONTEXT);
    expect(w.consents.granted.map(g => g.kind)).toEqual(['PRIVACY_POLICY']);
  });

  it('valida el género cuando viene', async () => {
    const { w, register } = setup();
    await expect(register.execute({ ...INPUT, genderId: 'g-x' }, CONTEXT)).rejects.toThrow(new IamNotFoundError('El género seleccionado no existe'));
    await register.execute({ ...INPUT, genderId: 'g-f' }, CONTEXT);
    expect(w.holders.created[0]!.holder.genderId).toBe('g-f');
  });
});

describe('RegisterClient — prerrequisitos y unicidad', () => {
  it('sin política activa o sin país de operación es un error interno', async () => {
    const { w, register } = setup();
    w.privacyPolicies.active = null;
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow(IamInternalError);
    w.privacyPolicies.active = ACTIVE_POLICY;
    w.catalogs.country = null;
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow('País de operación no configurado en BD. Contacta al administrador.');
  });

  it('el email debe estar verificado (OTP previo)', async () => {
    const { w, register } = setup();
    w.verificationCodes.verified.clear();
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow(new IamForbiddenError('El email debe estar verificado antes de registrarse'));
  });

  it('el tipo de documento debe existir, estar activo y ser visible al cliente', async () => {
    const { w, register } = setup();
    await expect(register.execute({ ...INPUT, documentTypeId: 'dt-x' }, CONTEXT)).rejects.toThrow('Tipo de documento no encontrado');
    w.catalogs.documentTypes.set('dt-off', { documentTypeId: 'dt-off', isActive: false, isVisibleToClient: true });
    await expect(register.execute({ ...INPUT, documentTypeId: 'dt-off' }, CONTEXT)).rejects.toThrow(IamNotFoundError);
    w.catalogs.documentTypes.set('dt-sys', { documentTypeId: 'dt-sys', isActive: true, isVisibleToClient: false });
    await expect(register.execute({ ...INPUT, documentTypeId: 'dt-sys' }, CONTEXT)).rejects.toThrow('Tipo de documento no permitido para registro');
  });

  it('email o documento ya registrados → 409, sin crear nada', async () => {
    const { w, register } = setup();
    w.holders.emailsInUse.add(EMAIL);
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow(new IamConflictError('El email ya está registrado'));
    w.holders.emailsInUse.clear();
    w.holders.nationalIdsInUse.add('99887766');
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow('El número de documento ya está registrado');
    expect(w.unitOfWork.runs).toBe(0);
  });
});

describe('RegisterClient — fallas dentro del alta', () => {
  it('si falla la preferencia o el consentimiento, el alta se revierte y responde un error interno', async () => {
    const { w, register } = setup();
    w.preferences.failWith = new Error('notification caído');
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow(new IamInternalError('Error al crear usuario. Intenta nuevamente'));
    expect(w.unitOfWork.rollbacks).toBe(1);

    w.preferences.failWith = null;
    w.consents.failWith = new Error('legal caído');
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow(IamInternalError);
    expect(w.unitOfWork.rollbacks).toBe(2);
    expect(w.audit.entries).toHaveLength(0);
    expect(w.logger.lines.filter(l => l.level === 'error').map(l => l.message)).toEqual([
      '_createUserInDB failed - error original',
      '_createUserInDB failed - error original'
    ]);
  });

  it('un error de dominio (rol CLIENTE ausente) se propaga tal cual', async () => {
    const { w, register } = setup();
    w.roles.roles = w.roles.roles.filter(r => r.name !== 'CLIENTE');
    await expect(register.execute(INPUT, CONTEXT)).rejects.toThrow('Rol CLIENTE no encontrado en BD. Ejecuta el seeder RBAC.');
  });
});

describe('RequestCredentialReset', () => {
  function withOwner(w: IamWorld) {
    w.holders.owners.set('ana@correo.co', { personId: 'p-ana', firstName: 'Ana' });
  }

  it('anti-enumeración: email desconocido o usuario inactivo responden false sin crear token', async () => {
    const w = iamWorld([user({ isActive: false })]);
    await expect(new RequestCredentialReset(w).execute({ email: 'nadie@correo.co', type: 'password' })).resolves.toBe(false);
    withOwner(w);
    await expect(new RequestCredentialReset(w).execute({ email: 'ana@correo.co', type: 'password' })).resolves.toBe(false);
    expect(w.credentialResets.created).toHaveLength(0);
    expect(w.notifier.emails).toHaveLength(0);
  });

  it('invalida los tokens anteriores, crea uno nuevo (15 min) y manda el enlace por email', async () => {
    const w = iamWorld();
    withOwner(w);
    w.credentialResets.add('viejo', 'password');
    await expect(new RequestCredentialReset(w).execute({ email: 'ana@correo.co', type: 'password' })).resolves.toBe(true);
    await settle();

    expect(w.credentialResets.resets[0]!.used).toBe(true);
    expect(w.credentialResets.created).toEqual([{ userId: CLIENT_ID, email: 'ana@correo.co', token: 'hex32-1', type: 'password', expiresAt: expect.any(Date) }]);
    const minutes = (w.credentialResets.created[0]!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    expect(w.audit.find('CREDENTIALS_RESET_REQUESTED')).toMatchObject({ details: { type: 'password' } });
    expect(w.notifier.emails).toEqual([
      {
        type: 'SOLICITUD_RESET_PASSWORD',
        email: 'ana@correo.co',
        metadata: {
          nombre: 'Ana',
          email: 'ana@correo.co',
          enlace: 'https://front.test/reset-password?token=hex32-1&type=password',
          minutosExpiracion: 15,
          logoUrl: 'https://cdn.test/logo.png'
        }
      }
    ]);
  });

  it('el reset de MFA usa su plantilla y su ruta', async () => {
    const w = iamWorld();
    withOwner(w);
    await new RequestCredentialReset(w).execute({ email: 'ana@correo.co', type: 'mfa' });
    await settle();
    expect(w.notifier.emails[0]).toMatchObject({ type: 'SOLICITUD_RESET_MFA', metadata: { enlace: 'https://front.test/reset-totp?token=hex32-1&type=mfa' } });
  });
});

describe('ConfirmCredentialReset', () => {
  it('token inválido o de otro tipo → 400 sin abrir transacción', async () => {
    const w = iamWorld();
    w.credentialResets.add('tok', 'mfa');
    const confirm = new ConfirmCredentialReset(w);
    await expect(confirm.execute({ token: 'otro', type: 'mfa' })).rejects.toThrow(new IamInvalidInputError('Token inválido o expirado'));
    await expect(confirm.execute({ token: 'tok', type: 'password', newPassword: 'x' })).rejects.toThrow('Tipo de reset incorrecto');
    expect(w.unitOfWork.runs).toBe(0);
  });

  it('password: cambia el hash, consume el token, audita, avisa y cierra todas las sesiones', async () => {
    const w = iamWorld();
    w.credentialResets.add('tok', 'password');
    w.sessions.sessions = [session()];
    await expect(new ConfirmCredentialReset(w).execute({ token: 'tok', type: 'password', newPassword: 'Otra#2026' })).resolves.toBeNull();
    await settle();
    expect(w.users.get(CLIENT_ID)?.passwordHash).toBe('hash:Otra#2026');
    expect(w.credentialResets.resets[0]!.used).toBe(true);
    expect(w.audit.actions()).toEqual(['PASSWORD_RESET_CONFIRMED']);
    expect(w.notifier.sent).toEqual([
      { type: 'RESET_PASSWORD', userId: CLIENT_ID, relatedEntity: null, metadata: { nombre: 'Ana', email: 'ana@correo.co', logoUrl: 'https://cdn.test/logo.png' } }
    ]);
    expect(w.revocations.invalidatedUsers.has(CLIENT_ID)).toBe(true);
    expect(w.sessions.get('s-1')).toMatchObject({ status: 'closed', closeReason: 'password_reset' });
  });

  it('password sin contraseña nueva revierte y no consume nada más', async () => {
    const w = iamWorld();
    w.credentialResets.add('tok', 'password');
    await expect(new ConfirmCredentialReset(w).execute({ token: 'tok', type: 'password' })).rejects.toThrow('La nueva contraseña es requerida');
    expect(w.unitOfWork.rollbacks).toBe(1);
    expect(w.audit.entries).toHaveLength(0);
  });

  it('mfa: apaga TOTP y SMS, registra los dos cambios y NO cierra sesiones', async () => {
    const w = iamWorld([user({ totpEnabled: true, totpSecret: 'enc(x)', smsMfaEnabled: true, preferredMfaMethod: 'totp' })]);
    w.credentialResets.add('tok', 'mfa');
    await new ConfirmCredentialReset(w).execute({ token: 'tok', type: 'mfa' });
    await settle();
    expect(w.users.get(CLIENT_ID)).toMatchObject({ totpEnabled: false, totpSecret: null, smsMfaEnabled: false, preferredMfaMethod: 'none' });
    expect(w.changeLog.changes.map(c => [c.changeType, c.changedByRole])).toEqual([
      ['mfa_status', 'system'],
      ['sms_mfa_status', 'system']
    ]);
    expect(w.audit.actions()).toEqual(['MFA_RESET_CONFIRMED']);
    expect(w.notifier.sent.map(n => n.type)).toEqual(['RESET_MFA']);
    expect(w.revocations.invalidatedUsers.size).toBe(0);
  });

  it('si otro request consumió el token primero, no aplica el reset y revierte', async () => {
    const w = iamWorld();
    w.credentialResets.add('tok', 'password');
    w.credentialResets.lostRace = true;
    await expect(new ConfirmCredentialReset(w).execute({ token: 'tok', type: 'password', newPassword: 'Otra#2026' })).rejects.toThrow('Token inválido o expirado');
    expect(w.users.updates).toHaveLength(0);
    expect(w.unitOfWork.rollbacks).toBe(1);
  });
});
