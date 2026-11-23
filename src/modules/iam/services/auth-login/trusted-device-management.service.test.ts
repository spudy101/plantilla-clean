// tests/unit/modules/shared-endpoints/kyc/iam/services/auth-login/trusted-device-management.service.test.ts
//
// blockDevice: regresión de la fase 4 de la migración a TS — el repositorio recibe desde qué
// dispositivo de confianza se bloqueó (antes blocked_by_device_id quedaba vacío).

jest.mock('../../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));
jest.mock('../../utils/device-blocklist.util', () => ({ block: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/token-blacklist.util', () => ({
  invalidateDeviceTokens: jest.fn().mockResolvedValue(undefined),
  invalidateUserSessions: jest.fn().mockResolvedValue(undefined)
}));

import { fixture } from 'tests/helpers/mock';
import TrustedDeviceManagementService from './trusted-device-management.service';

describe('TrustedDeviceManagementService.blockDevice', () => {
  it('registra el dispositivo de confianza que hizo el bloqueo', async () => {
    const trustedDeviceRepository = {
      findByFingerprint: jest.fn().mockResolvedValue({ userTrustedDeviceId: 'dev-actual', status: 'trusted' }),
      findByIdAndUser: jest.fn().mockResolvedValue({ userTrustedDeviceId: 'dev-x', status: 'pending', fingerprintHash: 'fp-x' }),
      countTrusted: jest.fn().mockResolvedValue(2),
      block: jest.fn().mockResolvedValue({ userTrustedDeviceId: 'dev-x', status: 'blocked' })
    };
    const service = new TrustedDeviceManagementService(fixture({ trustedDeviceRepository }));

    await service.blockDevice('u-1', 'dev-x', 'fp-actual').catch(() => undefined);

    expect(trustedDeviceRepository.block).toHaveBeenCalledWith('dev-x', 'dev-actual');
  });
});
