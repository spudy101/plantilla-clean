// tests/unit/modules/shared-endpoints/kyc/iam/services/mfa.service.test.ts
//
// MFAService — gestión del segundo factor (TOTP propio con otplib + SMS OTP vía SNS). Probamos las
// guardas y los caminos felices de cada operación aislando el acceso a datos: setup/activación/
// verificación/desactivación de TOTP, alta y confirmación de SMS MFA (con sus intentos y expiración),
// y la selección de método preferido. Se usa el AppError real para assertar statusCode. Las
// transacciones Sequelize se mockean (commit/rollback espiables) y las notificaciones diferidas en
// setImmediate se vacían con flushMacrotasks. `crypto`/OTP se hacen deterministas vía MOCKS.

jest.mock('../../../shared/database/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));

jest.mock('../repositories/user.repository', () => ({
  findById: jest.fn(),
  findWithPrimaryPhone: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
  updateTOTPStatus: jest.fn().mockResolvedValue(undefined),
  setTOTPStatus: jest.fn().mockResolvedValue(undefined),
  verifyPassword: jest.fn()
}));

jest.mock('../../notification/repositories/verification-code.repository', () => ({
  secondsUntilNewCode: jest.fn(),
  create: jest.fn(),
  findActiveByContact: jest.fn(),
  incrementAttempts: jest.fn().mockResolvedValue(undefined),
  markAsVerified: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../person/utils/kyc-shared.util', () => ({
  logChange: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/security/totp.util', () => ({
  generateSecret: jest.fn().mockReturnValue('SECRET123'),
  keyuri: jest.fn().mockReturnValue('otpauth://totp/x'),
  verify: jest.fn()
}));

jest.mock('../../../shared/security/encryption.util', () => ({
  encrypt: jest.fn().mockReturnValue('enc(secret)'),
  decrypt: jest.fn().mockReturnValue('SECRET123')
}));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../notification/services/sms.service', () => ({
  resolveE164: jest.fn().mockResolvedValue('+56911112222'),
  enviarSmsOtp: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

// MOCKS.EXTERNAL_PROVIDERS mutable: en true el OTP es fijo '123456'.
jest.mock('../../../shared/constants', () => ({ MOCKS: { EXTERNAL_PROVIDERS: false } }));

// DTOs a passthrough para no acoplar a su forma.
jest.mock('../responses/mfa.response', () => ({
  TOTPSetupResponseDTO: (x: Loose) => x,
  TOTPActivationResponseDTO: (x: Loose) => x,
  TOTPVerificationResponseDTO: (x: Loose) => x,
  PasswordValidationResponseDTO: (x: Loose) => x,
  SMSMFAActivationResponseDTO: (x: Loose) => x,
  SMSActivationRequestResponseDTO: (x: Loose) => x,
  MFAStatusResponseDTO: (x: Loose) => x,
  PreferredMethodResponseDTO: (x: Loose) => x
}));

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked, Loose } from 'tests/helpers/mock';
import prismaModule from '../../../shared/database/prisma';
const prisma = mocked(prismaModule);
import userRepoModule from '../repositories/user.repository';
const userRepo = mocked(userRepoModule);
import verificationCodeRepoModule from '../../notification/repositories/verification-code.repository';
const verificationCodeRepo = mocked(verificationCodeRepoModule);
import KycSharedUtilModule from '../../person/utils/kyc-shared.util';
const KycSharedUtil = mocked(KycSharedUtilModule);
import TotpUtilModule from '../../../shared/security/totp.util';
const TotpUtil = mocked(TotpUtilModule);
import NotificationUtilModule from '../../notification/notify';
const notifier = mocked(NotificationUtilModule);
import SmsServiceModule from '../../notification/services/sms.service';
const SmsService = mocked(SmsServiceModule);
import constantsModule from '../../../shared/constants';
const constants = mocked(constantsModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import mfa from './mfa.service';

const USER_ID = 'u-1';
const AUDIT = { ip: '1.2.3.4', userAgent: 'jest' };
const flushMacrotasks = () => new Promise(resolve => { setImmediate(resolve); });

function makeUser(overrides = {}) {
  return {
    userId: USER_ID,
    totpEnabled: false,
    totpSecret: null,
    smsMfaEnabled: false,
    preferredMfaMethod: 'none',
    passwordHash: 'hash',
    ...overrides
  };
}

function makeTx() {
  return { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
}

describe('MFAService', () => {
  let tx: Loose;

  beforeEach(() => {
    jest.clearAllMocks();
    // El lookup con teléfono (findWithPrimaryPhone) devuelve lo mismo que el stub de findById.
    userRepo.findWithPrimaryPhone.mockImplementation((...args) => userRepo.findById(...args));
    constants.MOCKS.EXTERNAL_PROVIDERS = false;
    tx = makeTx();
    prisma.$transaction.mockImplementation(managedTransaction(tx));
  });

  describe('setupTOTP', () => {
    it('lanza conflict si TOTP ya está activado', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: true }));
      await expect(mfa.setupTOTP(USER_ID, 'juan')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('genera y persiste el secreto CIFRADO sin activar, y devuelve el otpauth', async () => {
      userRepo.findById.mockResolvedValue(makeUser());

      const result = await mfa.setupTOTP(USER_ID, 'juan');

      expect(userRepo.update).toHaveBeenCalledWith(USER_ID, { totpSecret: 'enc(secret)' });
      expect(userRepo.updateTOTPStatus).not.toHaveBeenCalled(); // aún no se activa
      expect(result).toMatchObject({ otpauthUrl: 'otpauth://totp/x', secretCode: 'SECRET123' });
      expect(logAudit).toHaveBeenCalledWith('MFA_TOTP_SETUP', expect.objectContaining({ actorId: USER_ID, details: { username: 'juan' } }));
    });
  });

  describe('verifyAndActivateTOTP', () => {
    it('lanza badRequest si no hay secreto configurado', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpSecret: null }));
      await expect(mfa.verifyAndActivateTOTP('000000', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toMatchObject({
        statusCode: 400
      });
    });

    it('lanza badRequest si el código TOTP es inválido', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpSecret: 'enc' }));
      TotpUtil.verify.mockReturnValue(false);
      await expect(mfa.verifyAndActivateTOTP('999999', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled(); // verifica antes de abrir tx
    });

    it('activa TOTP en transacción, lo fija como preferido si era none, commitea y notifica', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpSecret: 'enc', preferredMfaMethod: 'none' }));
      TotpUtil.verify.mockReturnValue(true);

      const result = await mfa.verifyAndActivateTOTP('123456', USER_ID, 'juan', 'Juan', AUDIT);

      expect(userRepo.updateTOTPStatus).toHaveBeenCalledWith(USER_ID, true);
      expect(userRepo.update).toHaveBeenCalledWith(USER_ID, { preferredMfaMethod: 'totp' });
      expect(KycSharedUtil.logChange).toHaveBeenCalled();
      expect(tx.commit).toHaveBeenCalled();
      expect(result).toMatchObject({ totpEnabled: true });

      await flushMacrotasks();
      expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'TOTP_ACTIVADO' }));
    });

    it('hace rollback y propaga si falla dentro de la transacción', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpSecret: 'enc' }));
      TotpUtil.verify.mockReturnValue(true);
      userRepo.updateTOTPStatus.mockRejectedValueOnce(new Error('db fail'));

      await expect(mfa.verifyAndActivateTOTP('123456', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toThrow('db fail');
      expect(tx.rollback).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
    });
  });

  describe('verifyTOTP', () => {
    it('lanza badRequest si TOTP no está activado', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: false }));
      await expect(mfa.verifyTOTP('123456', USER_ID, 'juan')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('devuelve valid=true y audita MFA_VERIFIED cuando el código es correcto', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: true, totpSecret: 'enc' }));
      TotpUtil.verify.mockReturnValue(true);

      const result = await mfa.verifyTOTP('123456', USER_ID, 'juan');

      expect(result).toMatchObject({ valid: true });
      expect(logAudit).toHaveBeenCalledWith('MFA_VERIFIED', expect.objectContaining({ actorId: USER_ID, details: expect.objectContaining({ success: true }) }));
    });

    it('devuelve valid=false y audita MFA_FAILED cuando el código es incorrecto', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: true, totpSecret: 'enc' }));
      TotpUtil.verify.mockReturnValue(false);

      const result = await mfa.verifyTOTP('000000', USER_ID, 'juan');

      expect(result).toMatchObject({ valid: false });
      expect(logAudit).toHaveBeenCalledWith('MFA_FAILED', expect.objectContaining({ actorId: USER_ID, details: expect.objectContaining({ success: false }) }));
    });
  });

  describe('deactivateTOTP', () => {
    it('lanza unauthorized si la contraseña es incorrecta', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: true }));
      userRepo.verifyPassword.mockResolvedValue(false);
      await expect(mfa.deactivateTOTP('bad', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('borra el secreto y degrada el preferido a sms si SMS seguía activo', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: true, preferredMfaMethod: 'totp', smsMfaEnabled: true }));
      userRepo.verifyPassword.mockResolvedValue(true);

      const result = await mfa.deactivateTOTP('good', USER_ID, 'juan', 'Juan', AUDIT);

      expect(userRepo.setTOTPStatus).toHaveBeenCalledWith(USER_ID, false, null);
      expect(userRepo.update).toHaveBeenCalledWith(USER_ID, { preferredMfaMethod: 'sms' });
      expect(tx.commit).toHaveBeenCalled();
      expect(result).toMatchObject({ totpEnabled: false });
    });
  });

  describe('validatePassword', () => {
    it('refleja el resultado de verifyPassword y audita', async () => {
      userRepo.findById.mockResolvedValue(makeUser());
      userRepo.verifyPassword.mockResolvedValue(true);

      const result = await mfa.validatePassword('pw', USER_ID, 'juan');

      expect(result).toMatchObject({ valid: true });
      expect(logAudit).toHaveBeenCalledWith('MFA_PASSWORD_VALIDATED', expect.objectContaining({ actorId: USER_ID, details: expect.objectContaining({ success: true }) }));
    });
  });

  describe('getStatus', () => {
    it('devuelve el estado con defaults seguros', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: true, smsMfaEnabled: null, preferredMfaMethod: null }));

      const result = await mfa.getStatus(USER_ID, 'juan');

      expect(result).toMatchObject({ totpEnabled: true, smsMfaEnabled: false, preferredMfaMethod: 'none' });
    });
  });

  describe('requestSMSActivation', () => {
    function userWithPhone(overrides = {}) {
      return makeUser({
        person: { contact: { phonePrimary: '911112222', phonePrimaryPrefixId: 'pref-1' } },
        ...overrides
      });
    }

    it('lanza conflict si SMS MFA ya está activado', async () => {
      userRepo.findById.mockResolvedValue(userWithPhone({ smsMfaEnabled: true }));
      await expect(mfa.requestSMSActivation('pw', USER_ID, 'juan')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('lanza badRequest si el usuario no tiene teléfono', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ person: { contact: {} } }));
      userRepo.verifyPassword.mockResolvedValue(true);
      await expect(mfa.requestSMSActivation('pw', USER_ID, 'juan')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza tooManyRequests si aún no puede pedir un nuevo código', async () => {
      userRepo.findById.mockResolvedValue(userWithPhone());
      userRepo.verifyPassword.mockResolvedValue(true);
      verificationCodeRepo.secondsUntilNewCode.mockResolvedValue(42);
      await expect(mfa.requestSMSActivation('pw', USER_ID, 'juan')).rejects.toMatchObject({ statusCode: 429, retryAfter: 42 });
    });

    it('crea el código, lo envía por SMS (setImmediate) y devuelve el truncado', async () => {
      constants.MOCKS.EXTERNAL_PROVIDERS = true; // OTP fijo 123456 → truncado ****56
      userRepo.findById.mockResolvedValue(userWithPhone());
      userRepo.verifyPassword.mockResolvedValue(true);
      verificationCodeRepo.secondsUntilNewCode.mockResolvedValue(0);
      verificationCodeRepo.create.mockResolvedValue({ verificationCodeId: 'vc-1' });

      const result = await mfa.requestSMSActivation('pw', USER_ID, 'juan');

      expect(verificationCodeRepo.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'phone', code: '123456' }));
      expect(result).toMatchObject({ verificationCodeId: 'vc-1', truncatedCode: '****56' });

      await flushMacrotasks();
      expect(SmsService.resolveE164).toHaveBeenCalledWith('911112222', 'pref-1');
      expect(SmsService.enviarSmsOtp).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'mfa_setup' }));
    });
  });

  describe('confirmSMSActivation', () => {
    const PHONE_USER = () => makeUser({ person: { contact: { phonePrimary: '911112222' } } });

    it('lanza notFound si no hay código activo', async () => {
      userRepo.findById.mockResolvedValue(PHONE_USER());
      verificationCodeRepo.findActiveByContact.mockResolvedValue(null);
      await expect(mfa.confirmSMSActivation('123456', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('lanza forbidden si se agotaron los intentos', async () => {
      userRepo.findById.mockResolvedValue(PHONE_USER());
      verificationCodeRepo.findActiveByContact.mockResolvedValue({ verificationCodeId: 'vc-1', attempts: 5, code: '123456' });
      await expect(mfa.confirmSMSActivation('123456', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('con código incorrecto incrementa intentos y lanza badRequest con los restantes', async () => {
      userRepo.findById.mockResolvedValue(PHONE_USER());
      verificationCodeRepo.findActiveByContact.mockResolvedValue({ verificationCodeId: 'vc-1', attempts: 1, code: '123456' });

      await expect(mfa.confirmSMSActivation('000000', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toMatchObject({ statusCode: 400 });
      expect(verificationCodeRepo.incrementAttempts).toHaveBeenCalledWith('vc-1');
    });

    it('con código correcto marca verificado, activa SMS MFA y lo fija como preferido si era none', async () => {
      userRepo.findById.mockResolvedValue(PHONE_USER());
      verificationCodeRepo.findActiveByContact.mockResolvedValue({ verificationCodeId: 'vc-1', attempts: 0, code: '123456' });

      const result = await mfa.confirmSMSActivation('123456', USER_ID, 'juan', 'Juan', AUDIT);

      expect(verificationCodeRepo.markAsVerified).toHaveBeenCalledWith('vc-1');
      expect(userRepo.update).toHaveBeenCalledWith(USER_ID, { smsMfaEnabled: true, preferredMfaMethod: 'sms' });
      expect(tx.commit).toHaveBeenCalled();
      expect(result).toMatchObject({ smsMfaEnabled: true });
    });
  });

  describe('deactivateSMSMFA', () => {
    it('lanza badRequest si SMS MFA no está activado', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ smsMfaEnabled: false }));
      await expect(mfa.deactivateSMSMFA('pw', USER_ID, 'juan', 'Juan', AUDIT)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('desactiva y degrada el preferido a totp si TOTP seguía activo', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ smsMfaEnabled: true, preferredMfaMethod: 'sms', totpEnabled: true }));
      userRepo.verifyPassword.mockResolvedValue(true);

      const result = await mfa.deactivateSMSMFA('good', USER_ID, 'juan', 'Juan', AUDIT);

      expect(userRepo.update).toHaveBeenCalledWith(USER_ID, { smsMfaEnabled: false, preferredMfaMethod: 'totp' });
      expect(tx.commit).toHaveBeenCalled();
      expect(result).toMatchObject({ smsMfaEnabled: false });
    });
  });

  describe('updatePreferredMethod', () => {
    it('lanza badRequest si se elige totp sin TOTP activo', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: false }));
      await expect(mfa.updatePreferredMethod('totp', USER_ID, 'juan', AUDIT)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lanza badRequest si se elige sms sin SMS MFA activo', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ smsMfaEnabled: false }));
      await expect(mfa.updatePreferredMethod('sms', USER_ID, 'juan', AUDIT)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('actualiza el método preferido en transacción y commitea', async () => {
      userRepo.findById.mockResolvedValue(makeUser({ totpEnabled: true }));

      const result = await mfa.updatePreferredMethod('totp', USER_ID, 'juan', AUDIT);

      expect(userRepo.update).toHaveBeenCalledWith(USER_ID, { preferredMfaMethod: 'totp' });
      expect(tx.commit).toHaveBeenCalled();
      expect(result).toMatchObject({ preferredMfaMethod: 'totp' });
    });
  });
});
