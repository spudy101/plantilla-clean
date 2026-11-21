// tests/unit/modules/schemas/notification/services/sms.service.test.ts
//
// SmsService — canal de SMS (OTP/transaccional) vía AWS SNS. Probamos las cuatro ramas de envío sin
// tocar AWS: (1) modo mock → marca enviado y no llama al proveedor; (2) circuito abierto →
// marca fallido y responde circuitOpen; (3) camino feliz → markSent; (4) fallo → markFailed. Además
// enviarSms delega en enviarSmsOtp y resolveE164 arma E.164. `callProvider` (breaker, reintentos,
// timeout y log) se mockea: se prueba en provider-call.util.test.

jest.mock('@aws-sdk/client-sns', () => ({ SNSClient: class {}, PublishCommand: class {} }));

jest.mock('../repositories/sms-delivery-attempt.repository', () => ({
  createAttempt: jest.fn(),
  markSent: jest.fn().mockResolvedValue(undefined),
  markFailed: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../catalogs/repositories/phone-prefix.repository', () => ({
  findById: jest.fn()
}));

jest.mock('../../../shared/infra/provider-call.util', () => ({
  callProvider: jest.fn(),
  CircuitOpenError: class CircuitOpenError extends Error {}
}));
jest.mock('../../../shared/security/encryption.util', () => ({ generateHash: jest.fn().mockReturnValue('phone-hash') }));

jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));

// MOCKS.EXTERNAL_PROVIDERS es mutable: se alterna por test.
jest.mock('../../../shared/constants', () => ({
  MOCKS: { EXTERNAL_PROVIDERS: false },
  aws: { region: 'us-east-1', accessKeyId: 'ak', secretAccessKey: 'sk' }
}));

import { mocked } from 'tests/helpers/mock';
import attemptRepoModule from '../repositories/sms-delivery-attempt.repository';
const attemptRepo = mocked(attemptRepoModule);
import phonePrefixRepoModule from '../../catalogs/repositories/phone-prefix.repository';
const phonePrefixRepo = mocked(phonePrefixRepoModule);
import * as providerCallModule from '../../../shared/infra/provider-call.util';
const callProvider = mocked(providerCallModule.callProvider);
const { CircuitOpenError } = providerCallModule;
import constantsModule from '../../../shared/constants';
const constants = mocked(constantsModule);
import sms from './sms.service';

const ATTEMPT_ID = 'att-1';
const okParams = { phoneNumber: '+56911112222', message: 'Tu código es 123456', userId: 'u-1', purpose: 'mfa_login' };

describe('SmsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    constants.MOCKS.EXTERNAL_PROVIDERS = false;
    attemptRepo.createAttempt.mockResolvedValue({ smsDeliveryAttemptId: ATTEMPT_ID, purpose: 'mfa_login' });
  });

  describe('enviarSmsOtp — modo mock', () => {
    it('marca enviado con id MOCK-*, no llama al proveedor y responde mock:true', async () => {
      constants.MOCKS.EXTERNAL_PROVIDERS = true;

      const result = await sms.enviarSmsOtp(okParams);

      expect(callProvider).not.toHaveBeenCalled();
      expect(attemptRepo.markSent).toHaveBeenCalledWith(ATTEMPT_ID, { providerMessageId: `MOCK-${ATTEMPT_ID}` });
      expect(result).toEqual({ success: true, attemptId: ATTEMPT_ID, mock: true });
    });
  });

  describe('enviarSmsOtp — circuito abierto', () => {
    it('marca fallido y responde circuitOpen', async () => {
      callProvider.mockRejectedValue(new CircuitOpenError('aws_sms', 5000));

      const result = await sms.enviarSmsOtp(okParams);

      expect(attemptRepo.markFailed).toHaveBeenCalledWith(ATTEMPT_ID, expect.objectContaining({ lastError: expect.stringMatching(/Circuit breaker/i) }));
      expect(result).toMatchObject({ success: false, attemptId: ATTEMPT_ID, circuitOpen: true });
    });
  });

  describe('enviarSmsOtp — camino feliz', () => {
    it('envía por callProvider (aws_sms) y marca enviado', async () => {
      callProvider.mockResolvedValue({ messageId: 'msg-99' });

      const result = await sms.enviarSmsOtp(okParams);

      expect(callProvider).toHaveBeenCalledWith({ product: 'aws_sms', endpoint: 'SNS:PublishCommand:SMS' }, expect.any(Function));
      // el teléfono va hasheado a la tabla de intentos, nunca al log
      expect(attemptRepo.createAttempt).toHaveBeenCalledWith(expect.objectContaining({ phoneHash: 'phone-hash', purpose: 'mfa_login' }));
      expect(attemptRepo.markSent).toHaveBeenCalledWith(ATTEMPT_ID, { providerMessageId: 'msg-99' });
      expect(result).toEqual({ success: true, attemptId: ATTEMPT_ID });
    });
  });

  describe('enviarSmsOtp — fallo del proveedor', () => {
    it('marca fallido y responde serviceUnavailable', async () => {
      callProvider.mockRejectedValue(new Error('SNS timeout'));

      const result = await sms.enviarSmsOtp(okParams);

      expect(attemptRepo.markFailed).toHaveBeenCalledWith(ATTEMPT_ID, { lastError: 'SNS timeout' });
      expect(result).toMatchObject({ success: false, attemptId: ATTEMPT_ID, error: 'SNS timeout', serviceUnavailable: true });
    });
  });

  describe('enviarSms', () => {
    it('delega en enviarSmsOtp (misma infraestructura)', async () => {
      constants.MOCKS.EXTERNAL_PROVIDERS = true;
      const spy = jest.spyOn(sms, 'enviarSmsOtp');

      await sms.enviarSms({ phoneNumber: '+56911112222', message: 'hola', userId: 'u-2', purpose: 'alerta' });

      expect(spy).toHaveBeenCalledWith({ phoneNumber: '+56911112222', message: 'hola', userId: 'u-2', purpose: 'alerta' });
      spy.mockRestore();
    });
  });

  describe('resolveE164', () => {
    it('devuelve el número tal cual si ya viene en E.164', async () => {
      await expect(sms.resolveE164('+56911112222', 'pref-1')).resolves.toBe('+56911112222');
      expect(phonePrefixRepo.findById).not.toHaveBeenCalled();
    });

    it('devuelve el número local si no hay prefijo', async () => {
      await expect(sms.resolveE164('911112222', null)).resolves.toBe('911112222');
      expect(phonePrefixRepo.findById).not.toHaveBeenCalled();
    });

    it('antepone el prefijo resuelto', async () => {
      phonePrefixRepo.findById.mockResolvedValue({ prefix: '+56' });
      await expect(sms.resolveE164('911112222', 'pref-1')).resolves.toBe('+56911112222');
    });

    it('devuelve el local si el prefijo no resuelve', async () => {
      phonePrefixRepo.findById.mockResolvedValue(null);
      await expect(sms.resolveE164('911112222', 'pref-x')).resolves.toBe('911112222');
    });
  });
});
