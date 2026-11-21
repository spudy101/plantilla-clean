// tests/unit/modules/shared-endpoints/kyc/iam/services/auth-login/login-policy-gate.service.test.ts
//
// LoginPolicyGateService: compuerta de política de privacidad que comparten el login por
// contraseña y el biométrico. Dependencias inyectadas por constructor (SOLID: D).

jest.mock('../../../../shared/infrastructure/observability/logger.util', () => ({ logger: { warn: jest.fn() }, logAudit: jest.fn() }));
jest.mock('../../../audit/audit.service', () => ({ record: jest.fn() }));

import { mocked, fixture } from 'tests/helpers/mock';
import LoginPolicyGateService from './login-policy-gate.service';
import auditServiceModule from '../../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import constantsModule from '../../../../shared/infrastructure/config';
const { INTERNAL_ROLE_NAMES } = constantsModule;

const ACTIVE_POLICY = { privacyPolicyId: 'pp-2', version: '2.0', documentUrl: 'http://x/p.pdf', summary: 's', effectiveDate: 'd' };
const CONTEXT = { blockedAuditAction: 'LOGIN_BLOCKED_POLICY_UPDATE' as const, source: 'auth-login' };

const makeGate = ({ activePolicy = ACTIVE_POLICY } = {}) => {
  const deps = {
    userRepository: { updatePrivacyPolicy: jest.fn().mockResolvedValue(undefined) },
    privacyPolicyRepository: { findActive: jest.fn().mockResolvedValue(activePolicy) },
    consentRecorder: { grantPrivacyPolicy: jest.fn().mockResolvedValue({}) }
  };
  return { gate: new LoginPolicyGateService(fixture(deps)), deps };
};

const client = (over = {}) => ({ userId: 'u-1', role: { name: 'cliente' }, privacyPolicyVersion: '1.0', ...over });

describe('LoginPolicyGateService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deja pasar a usuarios internos sin evaluar la versión', async () => {
    const { gate } = makeGate();
    await expect(gate.check(fixture(client({ role: { name: INTERNAL_ROLE_NAMES[0] } })), false, null, CONTEXT)).resolves.toBeNull();
  });

  it('deja pasar si no hay política activa o si el usuario ya está en la versión activa', async () => {
    await expect(
      makeGate(fixture({ activePolicy: null })).gate.check(fixture(client()), false, null, CONTEXT)
    ).resolves.toBeNull();
    await expect(
      makeGate().gate.check(fixture(client({ privacyPolicyVersion: '2.0' })), false, null, CONTEXT)
    ).resolves.toBeNull();
  });

  it('con acceptPolicy=true registra la versión, el consentimiento y la auditoría, y deja pasar', async () => {
    const { gate, deps } = makeGate();

    await expect(gate.check(fixture(client()), true, '1.2.3.4', CONTEXT)).resolves.toBeNull();

    expect(deps.userRepository.updatePrivacyPolicy).toHaveBeenCalledWith('u-1', expect.objectContaining({ version: '2.0', acceptedIp: '1.2.3.4' }));
    expect(deps.consentRecorder.grantPrivacyPolicy).toHaveBeenCalledWith({ userId: 'u-1', privacyPolicyId: 'pp-2', ip: '1.2.3.4' });
    expect(logAudit).toHaveBeenCalledWith('PRIVACY_POLICY_ACCEPTED', expect.objectContaining({ actorId: 'u-1' }));
  });

  it('versión desactualizada sin aceptar: audita con la acción del origen y devuelve el DTO de bloqueo', async () => {
    const { gate, deps } = makeGate();

    const result = await gate.check(fixture(client()), false, null, { blockedAuditAction: 'BIOMETRIC_LOGIN_BLOCKED_POLICY_UPDATE' as const, source: 'auth-biometric' });

    expect(deps.userRepository.updatePrivacyPolicy).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith('BIOMETRIC_LOGIN_BLOCKED_POLICY_UPDATE', expect.objectContaining({ actorId: 'u-1', outcome: 'failure' }));
    expect(result).toMatchObject({
      requiresPolicyAcceptance: true,
      policy: { currentVersion: '1.0', newVersion: '2.0', documentUrl: 'http://x/p.pdf' }
    });
  });
});
