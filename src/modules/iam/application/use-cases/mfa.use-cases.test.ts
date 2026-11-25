// Segundo factor del propio usuario: TOTP (setup, activación, verificación, baja), SMS (pedido, confirmación, baja) y
// lo transversal (estado, método preferido, validar la contraseña), sobre dobles en memoria.
import {
  ActivateTotp,
  ConfirmSmsMfaActivation,
  DeactivateSmsMfa,
  DeactivateTotp,
  GetMfaStatus,
  MfaAccount,
  RequestSmsMfaActivation,
  SetupTotp,
  UpdatePreferredMfaMethod,
  ValidateMfaPassword,
  VerifyTotp
} from './mfa.use-cases';
import { IamConflictError, IamForbiddenError, IamNotFoundError, IamUnauthorizedError, UserNotFoundError } from '../../domain/errors';
import { CLIENT_ID, iamWorld, settle, TOTP_SECRET, user, VALID_TOTP } from '../../../../../tests/doubles/iam.doubles';
import type { UserProfile } from '../../domain/user';

const ACTOR = { userId: CLIENT_ID, username: 'user_ana', firstName: 'Ana' };
const PASSWORD = 'Correcta#2026';
const PHONE = '3001234567';

function setup(over: Partial<UserProfile> = {}) {
  const w = iamWorld([user(over)]);
  return { w, deps: { ...w, account: new MfaAccount(w) } };
}

const withTotp = { totpEnabled: true, totpSecret: `enc(${TOTP_SECRET})`, preferredMfaMethod: 'totp' };

describe('transversal', () => {
  it('ValidateMfaPassword responde si coincide y audita con el resultado', async () => {
    const { w, deps } = setup();
    await expect(new ValidateMfaPassword(deps).execute(ACTOR, PASSWORD)).resolves.toEqual({ valid: true, username: 'user_ana' });
    await expect(new ValidateMfaPassword(deps).execute(ACTOR, 'mala')).resolves.toEqual({ valid: false, username: 'user_ana' });
    expect(w.audit.entries.map(e => e.outcome)).toEqual(['success', 'failure']);
  });

  it('GetMfaStatus devuelve los flags con defaults seguros; una cuenta inexistente es 404', async () => {
    const { deps } = setup({ totpEnabled: null });
    await expect(new GetMfaStatus(deps).execute(ACTOR)).resolves.toEqual({
      userId: CLIENT_ID,
      username: 'user_ana',
      totpEnabled: false,
      smsMfaEnabled: false,
      preferredMfaMethod: 'none'
    });
    await expect(new GetMfaStatus(deps).execute({ ...ACTOR, userId: 'nadie' })).rejects.toThrow(UserNotFoundError);
  });

  it('UpdatePreferredMfaMethod exige el factor activo y registra el cambio en la bitácora', async () => {
    const { w, deps } = setup({ totpEnabled: true, smsMfaEnabled: false, preferredMfaMethod: 'none' });
    const update = new UpdatePreferredMfaMethod(deps);
    await expect(update.execute(ACTOR, 'sms')).rejects.toThrow('Debes activar SMS MFA antes de seleccionarlo como método preferido');
    await expect(update.execute(ACTOR, 'totp')).resolves.toEqual({ userId: CLIENT_ID, username: 'user_ana', preferredMfaMethod: 'totp' });
    expect(w.unitOfWork.runs).toBe(1);
    expect(w.users.get(CLIENT_ID)?.preferredMfaMethod).toBe('totp');
    expect(w.changeLog.changes).toEqual([
      expect.objectContaining({ changeType: 'preferred_mfa_method', previousValue: 'none', newValue: 'totp', changedByRole: 'user' })
    ]);
    expect(w.audit.actions()).toEqual(['MFA_PREFERRED_METHOD_UPDATED']);

    const { deps: sinTotp } = setup();
    await expect(new UpdatePreferredMfaMethod(sinTotp).execute(ACTOR, 'totp')).rejects.toThrow('Debes activar TOTP antes de seleccionarlo como método preferido');
  });
});

describe('TOTP', () => {
  it('setup guarda el secreto CIFRADO sin activar y devuelve el otpauth', async () => {
    const { w, deps } = setup();
    const result = await new SetupTotp(deps).execute(ACTOR);
    expect(result).toMatchObject({ otpauthUrl: `otpauth://totp/user_ana?secret=${TOTP_SECRET}`, secretCode: TOTP_SECRET, username: 'user_ana' });
    expect(w.users.get(CLIENT_ID)).toMatchObject({ totpSecret: `enc(${TOTP_SECRET})`, totpEnabled: false });
    expect(w.audit.actions()).toEqual(['MFA_TOTP_SETUP']);
  });

  it('setup sin username etiqueta con el userId; con TOTP activo es 409', async () => {
    const { deps } = setup();
    await expect(new SetupTotp(deps).execute({ userId: CLIENT_ID, username: null })).resolves.toMatchObject({
      otpauthUrl: `otpauth://totp/${CLIENT_ID}?secret=${TOTP_SECRET}`
    });
    const { deps: activo } = setup(withTotp);
    await expect(new SetupTotp(activo).execute(ACTOR)).rejects.toThrow(new IamConflictError('TOTP ya esta activado para este usuario'));
  });

  it('activar exige el setup previo y un código válido (sin abrir transacción si falla)', async () => {
    const { w, deps } = setup();
    await expect(new ActivateTotp(deps).execute(ACTOR, VALID_TOTP)).rejects.toThrow('Primero debes configurar TOTP');
    w.users.get(CLIENT_ID)!.totpSecret = `enc(${TOTP_SECRET})`;
    await expect(new ActivateTotp(deps).execute(ACTOR, '000000')).rejects.toThrow('Codigo TOTP invalido');
    expect(w.unitOfWork.runs).toBe(0);
  });

  it('activar enciende TOTP, lo deja como preferido si no había, registra la bitácora y avisa', async () => {
    const { w, deps } = setup({ totpSecret: `enc(${TOTP_SECRET})` });
    await expect(new ActivateTotp(deps).execute(ACTOR, VALID_TOTP)).resolves.toEqual({ userId: CLIENT_ID, username: 'user_ana', totpEnabled: true });
    await settle();
    expect(w.users.get(CLIENT_ID)).toMatchObject({ totpEnabled: true, preferredMfaMethod: 'totp' });
    expect(w.changeLog.changes[0]).toMatchObject({ changeType: 'mfa_status', previousValue: 'disabled', newValue: 'enabled' });
    expect(w.audit.actions()).toEqual(['MFA_TOTP_ACTIVATED']);
    expect(w.notifier.sent).toEqual([{ type: 'TOTP_ACTIVADO', userId: CLIENT_ID, relatedEntity: null, metadata: { nombre: 'Ana' } }]);
  });

  it('activar con SMS ya preferido no le cambia la preferencia', async () => {
    const { w, deps } = setup({ totpSecret: `enc(${TOTP_SECRET})`, smsMfaEnabled: true, preferredMfaMethod: 'sms' });
    await new ActivateTotp(deps).execute(ACTOR, VALID_TOTP);
    expect(w.users.get(CLIENT_ID)?.preferredMfaMethod).toBe('sms');
  });

  it('si la cuenta desaparece dentro de la transacción, revierte y es 404', async () => {
    const { w, deps } = setup({ totpSecret: `enc(${TOTP_SECRET})` });
    w.users.update = async () => null;
    await expect(new ActivateTotp(deps).execute(ACTOR, VALID_TOTP)).rejects.toThrow(UserNotFoundError);
    expect(w.unitOfWork.rollbacks).toBe(1);
    expect(w.audit.entries).toHaveLength(0);
  });

  it('verificar responde valid y audita MFA_VERIFIED / MFA_FAILED; sin TOTP activo es 400', async () => {
    const { w, deps } = setup(withTotp);
    await expect(new VerifyTotp(deps).execute(ACTOR, VALID_TOTP)).resolves.toEqual({ valid: true, username: 'user_ana' });
    await expect(new VerifyTotp(deps).execute(ACTOR, '000000')).resolves.toEqual({ valid: false, username: 'user_ana' });
    expect(w.audit.actions()).toEqual(['MFA_VERIFIED', 'MFA_FAILED']);
    const { deps: sinTotp } = setup();
    await expect(new VerifyTotp(sinTotp).execute(ACTOR, VALID_TOTP)).rejects.toThrow('TOTP no esta activado para este usuario');
  });

  it('desactivar exige la contraseña, borra el secreto y la preferencia cae a SMS si sigue activo', async () => {
    const { w, deps } = setup({ ...withTotp, smsMfaEnabled: true });
    await expect(new DeactivateTotp(deps).execute(ACTOR, 'mala')).rejects.toThrow(new IamUnauthorizedError('Contrasena incorrecta'));
    await expect(new DeactivateTotp(deps).execute(ACTOR, PASSWORD)).resolves.toEqual({ userId: CLIENT_ID, username: 'user_ana', totpEnabled: false });
    await settle();
    expect(w.users.get(CLIENT_ID)).toMatchObject({ totpEnabled: false, totpSecret: null, preferredMfaMethod: 'sms' });
    expect(w.changeLog.changes[0]).toMatchObject({ changeType: 'mfa_status', previousValue: 'enabled', newValue: 'disabled' });
    expect(w.notifier.sent.map(n => n.type)).toEqual(['TOTP_ELIMINADO']);
  });

  it('desactivar sin TOTP activo es 400', async () => {
    const { deps } = setup();
    await expect(new DeactivateTotp(deps).execute(ACTOR, PASSWORD)).rejects.toThrow('TOTP no esta activado');
  });
});

describe('SMS', () => {
  it('el pedido exige la contraseña y el teléfono; con SMS activo es 409', async () => {
    const { w, deps } = setup();
    await expect(new RequestSmsMfaActivation(deps).execute(ACTOR, 'mala')).rejects.toThrow(IamUnauthorizedError);
    w.users.get(CLIENT_ID)!.person!.contact!.phonePrimary = null;
    await expect(new RequestSmsMfaActivation(deps).execute(ACTOR, PASSWORD)).rejects.toThrow(
      'Debes registrar un número de teléfono antes de activar SMS MFA'
    );
    const { deps: activo } = setup({ smsMfaEnabled: true });
    await expect(new RequestSmsMfaActivation(activo).execute(ACTOR, PASSWORD)).rejects.toThrow(IamConflictError);
  });

  it('el pedido respeta la espera entre códigos (429)', async () => {
    const { w, deps } = setup();
    w.verificationCodes.waitSeconds = 40;
    await expect(new RequestSmsMfaActivation(deps).execute(ACTOR, PASSWORD)).rejects.toMatchObject({
      message: 'Debes esperar 40 segundos antes de solicitar un nuevo código',
      retryAfterSeconds: 40
    });
  });

  it('el pedido crea el código, lo manda en segundo plano y devuelve solo los dos últimos dígitos', async () => {
    const { w, deps } = setup();
    const result = await new RequestSmsMfaActivation(deps).execute(ACTOR, PASSWORD);
    await settle();
    expect(result).toEqual({ verificationCodeId: 'vc-1', expiresAt: expect.any(Date), truncatedCode: '****21' });
    expect(w.verificationCodes.codes[0]).toMatchObject({ kind: 'phone', value: PHONE, code: '654321' });
    expect(w.sms.sent).toEqual([
      { phoneNumber: `+57${PHONE}`, message: 'Tu código de activación de SMS MFA es 654321. Vence en 15 minutos.', userId: CLIENT_ID, purpose: 'mfa_setup' }
    ]);
    expect(w.audit.actions()).toEqual(['MFA_SMS_SETUP']);
  });

  it('confirmar: sin código vigente 404, ya usado 400, intentos agotados 403', async () => {
    const { w, deps } = setup();
    const confirm = new ConfirmSmsMfaActivation(deps);
    await expect(confirm.execute(ACTOR, '111222')).rejects.toThrow(new IamNotFoundError('Código de verificación no encontrado o expirado'));
    w.verificationCodes.add('phone', PHONE, '111222', 5);
    await expect(confirm.execute(ACTOR, '111222')).rejects.toThrow(IamForbiddenError);
    w.verificationCodes.codes[0]!.attempts = 0;
    w.verificationCodes.codes[0]!.verifiedAt = new Date();
    await expect(confirm.execute(ACTOR, '111222')).rejects.toThrow('Este código ya fue utilizado');
  });

  it('confirmar con un código incorrecto suma el intento y dice cuántos quedan (singular / plural)', async () => {
    const { w, deps } = setup();
    w.verificationCodes.add('phone', PHONE, '111222', 0);
    const confirm = new ConfirmSmsMfaActivation(deps);
    await expect(confirm.execute(ACTOR, '999999')).rejects.toThrow('Código inválido. Te quedan 4 intentos');
    w.verificationCodes.codes[0]!.attempts = 3;
    await expect(confirm.execute(ACTOR, '999999')).rejects.toThrow('Código inválido. Te quedan 1 intento');
    expect(w.verificationCodes.codes[0]!.attempts).toBe(4);
  });

  it('confirmar con el código correcto lo marca, enciende SMS (preferido si no había) y avisa', async () => {
    const { w, deps } = setup();
    w.verificationCodes.add('phone', PHONE, '111222');
    await expect(new ConfirmSmsMfaActivation(deps).execute(ACTOR, '111222')).resolves.toEqual({ userId: CLIENT_ID, username: 'user_ana', smsMfaEnabled: true });
    await settle();
    expect(w.verificationCodes.codes[0]!.verifiedAt).not.toBeNull();
    expect(w.users.get(CLIENT_ID)).toMatchObject({ smsMfaEnabled: true, preferredMfaMethod: 'sms' });
    expect(w.changeLog.changes[0]).toMatchObject({ changeType: 'sms_mfa_status', newValue: 'enabled' });
    expect(w.notifier.sent.map(n => n.type)).toEqual(['SMS_MFA_ACTIVADO']);
  });

  it('desactivar exige la contraseña y la preferencia cae a TOTP si sigue activo', async () => {
    const { w, deps } = setup({ smsMfaEnabled: true, preferredMfaMethod: 'sms', totpEnabled: true });
    await expect(new DeactivateSmsMfa(deps).execute(ACTOR, 'mala')).rejects.toThrow(IamUnauthorizedError);
    await expect(new DeactivateSmsMfa(deps).execute(ACTOR, PASSWORD)).resolves.toEqual({ userId: CLIENT_ID, username: 'user_ana', smsMfaEnabled: false });
    await settle();
    expect(w.users.get(CLIENT_ID)).toMatchObject({ smsMfaEnabled: false, preferredMfaMethod: 'totp' });
    expect(w.notifier.sent.map(n => n.type)).toEqual(['SMS_MFA_DESACTIVADO']);

    const { deps: sinSms } = setup();
    await expect(new DeactivateSmsMfa(sinSms).execute(ACTOR, PASSWORD)).rejects.toThrow('SMS MFA no está activado');
  });
});
