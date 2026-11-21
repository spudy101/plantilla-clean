// tests/unit/modules/schemas/records/legal/services/consent-recorder.service.test.ts
//
// ConsentRecorderService centraliza el registro de consentimientos (antes duplicado en
// auth-login, auth-register y auth-biometric). Se prueba SIN jest.mock de repositorios:
// las dependencias se inyectan por constructor (SOLID: D).


import { fixture } from 'tests/helpers/mock';
import consentRecorderServiceModule from './consent-recorder.service';
const { ConsentRecorderService } = consentRecorderServiceModule;

const makeDeps = ({ consentType = { consentTypeId: 'ct-1' }, activePolicy = { privacyPolicyId: 'pp-9' } } = {}) => ({
  consentTypeRepository: { findByCode: jest.fn().mockResolvedValue(consentType) },
  userConsentRepository: { grant: jest.fn().mockResolvedValue({ userConsentId: 'uc-1' }) },
  privacyPolicyRepository: { findActive: jest.fn().mockResolvedValue(activePolicy) }
});

describe('ConsentRecorderService', () => {
  it('grantPrivacyPolicy con privacyPolicyId explícito no consulta la política activa', async () => {
    const deps = makeDeps();
    const recorder = new ConsentRecorderService(fixture(deps));

    await recorder.grantPrivacyPolicy({ userId: 'u-1', privacyPolicyId: 'pp-1', ip: '1.1.1.1' });

    expect(deps.privacyPolicyRepository.findActive).not.toHaveBeenCalled();
    expect(deps.userConsentRepository.grant).toHaveBeenCalledWith({
      userId: 'u-1',
      consentTypeId: 'ct-1',
      privacyPolicyId: 'pp-1',
      ip: '1.1.1.1',
      userAgent: null
    });
  });

  it('grantPrivacyPolicy sin privacyPolicyId usa la política activa', async () => {
    const deps = makeDeps();
    const recorder = new ConsentRecorderService(fixture(deps));

    const record = await recorder.grantPrivacyPolicy({ userId: 'u-1' });

    expect(record).toEqual({ userConsentId: 'uc-1' });
    expect(deps.userConsentRepository.grant).toHaveBeenCalledWith(expect.objectContaining({ privacyPolicyId: 'pp-9', ip: null }));
  });

  it('devuelve null y no escribe si el tipo de consentimiento no existe', async () => {
    const deps = makeDeps(fixture({ consentType: null }));
    const recorder = new ConsentRecorderService(fixture(deps));

    await expect(recorder.grantCommercialCommunications({ userId: 'u-1' })).resolves.toBeNull();
    expect(deps.userConsentRepository.grant).not.toHaveBeenCalled();
  });

  it('grantCommercialCommunications registra sin política asociada', async () => {
    const deps = makeDeps();
    const recorder = new ConsentRecorderService(fixture(deps));

    await recorder.grantCommercialCommunications({ userId: 'u-1', ip: '2.2.2.2' });

    expect(deps.userConsentRepository.grant).toHaveBeenCalledWith(
      expect.objectContaining({ consentTypeId: 'ct-1', privacyPolicyId: null, ip: '2.2.2.2' })
    );
  });
});
