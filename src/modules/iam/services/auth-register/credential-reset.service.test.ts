// tests/unit/modules/client/kyc/iam/services/auth-register/credential-reset.service.test.ts
//
// CredentialResetService (extraído de AuthRegisterService). Se prueba SIN jest.mock de
// repositorios: las dependencias se inyectan por constructor (SOLID: D).

jest.mock('../../../../shared/infrastructure/observability/logger.util', () => ({ logger: { info: jest.fn(), warn: jest.fn() }, logAudit: jest.fn() }));
jest.mock('../../../audit/audit.service', () => ({ record: jest.fn() }));
jest.mock('../../utils/token-blacklist.util', () => ({ invalidateUserSessions: jest.fn().mockResolvedValue(undefined) }));

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked, Loose, fixture } from 'tests/helpers/mock';
import CredentialResetService from './credential-reset.service';
import TokenBlacklistUtilModule from '../../utils/token-blacklist.util';
const TokenBlacklistUtil = mocked(TokenBlacklistUtilModule);
import auditServiceModule from '../../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;

const flush = () => new Promise(resolve => { setImmediate(resolve); });

const makeService = () => {
  const transaction = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
  const deps = {
    // UoW falso con la semántica de run(): commit si el trabajo termina bien, rollback si lanza
    unitOfWork: { run: jest.fn(managedTransaction(transaction)) },
    userRepository: { updatePassword: jest.fn().mockResolvedValue(undefined), update: jest.fn().mockResolvedValue(undefined) },
    personContactRepository: { findByEmailWithUser: jest.fn() },
    credentialResetRepository: {
      invalidateUserTokens: jest.fn().mockResolvedValue(0),
      createResetToken: jest.fn().mockResolvedValue({}),
      findValidTokenWithUser: jest.fn(),
      markAsUsed: jest.fn().mockResolvedValue(true)
    },
    userSessionRepository: { closeAllByUser: jest.fn().mockResolvedValue(undefined) },
    notifier: {
      notify: jest.fn().mockResolvedValue({}),
      notifyEmail: jest.fn().mockResolvedValue({})
    },
    kycSharedUtil: { logChange: jest.fn().mockResolvedValue(undefined) }
  };
  return { service: new CredentialResetService(fixture(deps)), deps, transaction };
};

const resetRecord = (type: Loose, over = {}) => ({
  credentialResetId: 'rc-1',
  type,
  user: { userId: 'u-1', person: { firstName: 'Ada', contact: { email: 'ada@x.cl' } } },
  ...over
});

describe('CredentialResetService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('requestResetCredentials', () => {
    it('anti-enumeración: email inexistente o usuario inactivo responden false sin crear token', async () => {
      const { service, deps } = makeService();
      deps.personContactRepository.findByEmailWithUser.mockResolvedValueOnce(null);
      await expect(service.requestResetCredentials({ email: 'x@x.cl', type: 'password' })).resolves.toBe(false);

      deps.personContactRepository.findByEmailWithUser.mockResolvedValueOnce({
        person: { user: { userId: 'u-1', isActive: false } }
      });
      await expect(service.requestResetCredentials({ email: 'x@x.cl', type: 'password' })).resolves.toBe(false);

      expect(deps.credentialResetRepository.createResetToken).not.toHaveBeenCalled();
    });

    it('crea un token nuevo invalidando los anteriores y envía el enlace por email', async () => {
      const { service, deps } = makeService();
      deps.personContactRepository.findByEmailWithUser.mockResolvedValue({
        person: { firstName: 'Ada', user: { userId: 'u-1', isActive: true } }
      });

      await expect(service.requestResetCredentials({ email: 'ada@x.cl', type: 'mfa' })).resolves.toBe(true);
      await flush();

      expect(deps.credentialResetRepository.invalidateUserTokens).toHaveBeenCalledWith('u-1');
      expect(deps.credentialResetRepository.createResetToken).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', email: 'ada@x.cl', type: 'mfa', token: expect.stringMatching(/^[a-f0-9]{64}$/) })
      );
      expect(deps.notifier.notifyEmail).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SOLICITUD_RESET_MFA', email: 'ada@x.cl' })
      );
    });
  });

  describe('confirmResetCredentials', () => {
    it('token inválido o de otro tipo → 400 sin abrir transacción', async () => {
      const { service, deps } = makeService();
      deps.credentialResetRepository.findValidTokenWithUser.mockResolvedValueOnce(null);
      await expect(service.confirmResetCredentials({ token: 't', type: 'password' })).rejects.toMatchObject({ statusCode: 400 });

      deps.credentialResetRepository.findValidTokenWithUser.mockResolvedValueOnce(resetRecord('mfa'));
      await expect(service.confirmResetCredentials({ token: 't', type: 'password' })).rejects.toThrow('Tipo de reset incorrecto');

      expect(deps.unitOfWork.run).not.toHaveBeenCalled();
    });

    it('password: actualiza, marca el token usado en la transacción e invalida todas las sesiones', async () => {
      const { service, deps, transaction } = makeService();
      deps.credentialResetRepository.findValidTokenWithUser.mockResolvedValue(resetRecord('password'));

      await service.confirmResetCredentials({ token: 't', type: 'password', newPassword: 'N3w!pass' });

      expect(deps.userRepository.updatePassword).toHaveBeenCalledWith('u-1', 'N3w!pass');
      expect(deps.credentialResetRepository.markAsUsed).toHaveBeenCalledWith('rc-1');
      expect(transaction.commit).toHaveBeenCalled();
      expect(TokenBlacklistUtil.invalidateUserSessions).toHaveBeenCalledWith('u-1');
      expect(deps.userSessionRepository.closeAllByUser).toHaveBeenCalledWith('u-1', 'password_reset');
      expect(logAudit).toHaveBeenCalledWith('PASSWORD_RESET_CONFIRMED', expect.objectContaining({ actorId: 'u-1', details: { type: 'password' } }));
    });

    it('mfa: baja TOTP y SMS, registra ambos cambios y NO cierra sesiones', async () => {
      const { service, deps } = makeService();
      deps.credentialResetRepository.findValidTokenWithUser.mockResolvedValue(resetRecord('mfa'));

      await service.confirmResetCredentials({ token: 't', type: 'mfa' });

      expect(deps.userRepository.update).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ totpEnabled: false, totpSecret: null, smsMfaEnabled: false, preferredMfaMethod: 'none' })
      );
      expect(deps.kycSharedUtil.logChange.mock.calls.map(([data]) => data.changeType)).toEqual(['mfa_status', 'sms_mfa_status']);
      expect(deps.userSessionRepository.closeAllByUser).not.toHaveBeenCalled();
    });

    it('si otro request ya consumió el token, no aplica el reset y revierte', async () => {
      const { service, deps, transaction } = makeService();
      deps.credentialResetRepository.findValidTokenWithUser.mockResolvedValue(resetRecord('password'));
      deps.credentialResetRepository.markAsUsed.mockResolvedValue(false);

      await expect(
        service.confirmResetCredentials({ token: 't', type: 'password', newPassword: 'Nueva123!' })
      ).rejects.toMatchObject({
        statusCode: 400
      });
      expect(deps.userRepository.updatePassword).not.toHaveBeenCalled();
      expect(transaction.rollback).toHaveBeenCalled();
      expect(transaction.commit).not.toHaveBeenCalled();
    });

    it('si falla dentro de la transacción hace rollback y propaga', async () => {
      const { service, deps, transaction } = makeService();
      deps.credentialResetRepository.findValidTokenWithUser.mockResolvedValue(resetRecord('password'));

      await expect(service.confirmResetCredentials({ token: 't', type: 'password' })).rejects.toThrow('La nueva contraseña es requerida');
      expect(transaction.rollback).toHaveBeenCalled();
      expect(transaction.commit).not.toHaveBeenCalled();
    });
  });
});
