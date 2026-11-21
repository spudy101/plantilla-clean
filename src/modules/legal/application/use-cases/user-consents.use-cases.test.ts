// Casos de uso de consentimientos otorgados (cliente, admin, registro/login y verificación), con dobles en
// memoria de sus puertos.
import { ListMyConsents } from './list-my-consents.use-case';
import { GrantConsents } from './grant-consents.use-case';
import { RevokeConsent } from './revoke-consent.use-case';
import { ListUserConsents } from './list-user-consents.use-case';
import { GetUserConsentHistory } from './get-user-consent-history.use-case';
import { GrantPrivacyPolicyConsent } from './grant-privacy-policy-consent.use-case';
import { GrantCommercialCommunicationsConsent } from './grant-commercial-communications-consent.use-case';
import { VerifyConsent } from './verify-consent.use-case';
import {
  ConsentHistoryNotFoundError,
  ConsentNotRevocableError,
  ConsentRequiredError,
  ConsentTypeNotConfiguredError,
  ConsentTypeNotFoundError,
  NoActiveConsentToRevokeError,
  NoConsentsToGrantError,
  OptionalConsentGateError,
  UnknownConsentTypeError
} from '../../domain/errors';
import { RecordingAuditTrail, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import {
  consentType,
  CountingUnitOfWork,
  InMemoryConsentTypes,
  InMemoryPrivacyPolicies,
  InMemoryUserConsents,
  privacyPolicy,
  userConsent
} from '../../../../../tests/doubles/legal.doubles';

const PAGE = { page: 1, limit: 10, sortBy: 'grantedAt', order: 'DESC' as const };
const PRIVACY = consentType({ consentTypeId: 'ct-pp', code: 'PRIVACY_POLICY' });
const MARKETING = consentType({ consentTypeId: 'ct-mk', code: 'COMUNICACIONES_COMERCIALES', isMandatory: false, isRevocable: true });

describe('ListMyConsents', () => {
  it('cada tipo activo con el consentimiento vigente del usuario (o sin otorgar) y audita', async () => {
    const audit = new RecordingAuditTrail();
    const consents = new InMemoryUserConsents([userConsent({ userId: 'u-1', consentTypeId: 'ct-pp', userConsentId: 'uc-1' })]);
    const catalog = await new ListMyConsents(new InMemoryConsentTypes([PRIVACY, MARKETING]), consents, audit).execute({ userId: 'u-1' });

    expect(catalog.map(c => [c.consentType.code, c.granted, c.userConsentId])).toEqual([
      ['PRIVACY_POLICY', true, 'uc-1'],
      ['COMUNICACIONES_COMERCIALES', false, null]
    ]);
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_CATALOG_VIEWED', details: { totalItems: 2, grantedCount: 1 } });
  });
});

describe('GrantConsents', () => {
  const setup = () => {
    const unitOfWork = new CountingUnitOfWork();
    const consents = new InMemoryUserConsents();
    const audit = new RecordingAuditTrail();
    const useCase = new GrantConsents(unitOfWork, new InMemoryConsentTypes([PRIVACY, MARKETING]), consents, audit, silentLogger);
    return { unitOfWork, consents, audit, useCase };
  };

  it('otorga todos en una unidad de trabajo y audita cada uno después', async () => {
    const { unitOfWork, consents, audit, useCase } = setup();
    const granted = await useCase.execute({
      userId: 'u-1',
      items: [{ consentTypeCode: 'PRIVACY_POLICY', privacyPolicyId: 'pp-1' }, { consentTypeCode: 'COMUNICACIONES_COMERCIALES' }],
      ip: '1.2.3.4',
      userAgent: 'jest'
    });

    expect(unitOfWork.runs).toBe(1);
    expect(granted.map(g => g.consentTypeId)).toEqual(['ct-pp', 'ct-mk']);
    expect(consents.grants[0]).toEqual({ userId: 'u-1', consentTypeId: 'ct-pp', privacyPolicyId: 'pp-1', ip: '1.2.3.4', userAgent: 'jest' });
    expect(consents.grants[1]?.privacyPolicyId).toBeNull();
    expect(audit.entries.map(e => e.action)).toEqual(['CONSENT_GRANTED', 'CONSENT_GRANTED']);
  });

  it('lista vacía → NoConsentsToGrantError', async () => {
    await expect(setup().useCase.execute({ userId: 'u', items: [], ip: null, userAgent: null })).rejects.toBeInstanceOf(NoConsentsToGrantError);
  });

  it('un tipo inexistente corta todo y no audita nada', async () => {
    const { audit, useCase } = setup();
    await expect(
      useCase.execute({ userId: 'u', items: [{ consentTypeCode: 'PRIVACY_POLICY' }, { consentTypeCode: 'NOPE' }], ip: null, userAgent: null })
    ).rejects.toBeInstanceOf(UnknownConsentTypeError);
    expect(audit.entries).toEqual([]);
  });
});

describe('RevokeConsent', () => {
  const setup = (consents = new InMemoryUserConsents([userConsent({ userId: 'u-1', consentTypeId: 'ct-mk' })])) => {
    const audit = new RecordingAuditTrail();
    const useCase = new RevokeConsent(new CountingUnitOfWork(), new InMemoryConsentTypes([PRIVACY, MARKETING]), consents, audit, silentLogger);
    return { consents, audit, useCase };
  };

  it('revoca el vigente y audita con el motivo', async () => {
    const { consents, audit, useCase } = setup();
    await expect(useCase.execute({ userId: 'u-1', consentTypeId: 'ct-mk', ip: null, reason: 'ya no' })).resolves.toEqual({
      message: 'Consentimiento revocado exitosamente'
    });
    expect(consents.consents[0]).toMatchObject({ isCurrent: false, revocationReason: 'ya no' });
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_REVOKED', details: { consentTypeId: 'ct-mk', reason: 'ya no' } });
  });

  it('tipo inexistente / no revocable / sin consentimiento vigente', async () => {
    const { useCase } = setup(new InMemoryUserConsents());
    await expect(useCase.execute({ userId: 'u-1', consentTypeId: 'x', ip: null })).rejects.toBeInstanceOf(ConsentTypeNotFoundError);
    await expect(useCase.execute({ userId: 'u-1', consentTypeId: 'ct-pp', ip: null })).rejects.toBeInstanceOf(ConsentNotRevocableError);
    await expect(useCase.execute({ userId: 'u-1', consentTypeId: 'ct-mk', ip: null })).rejects.toBeInstanceOf(NoActiveConsentToRevokeError);
  });
});

describe('ListUserConsents', () => {
  it('pasa solo los filtros con valor y los audita por nombre', async () => {
    const consents = new InMemoryUserConsents([userConsent({ withRefs: true })]);
    const audit = new RecordingAuditTrail();
    const result = await new ListUserConsents(consents, audit).execute({
      actorId: 'a',
      query: { ...PAGE, userId: 'u-1', consentTypeCode: undefined, isCurrent: null }
    });

    expect(consents.lastAdminFilters[0]).toEqual({ userId: 'u-1' });
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_LIST_VIEWED', details: { totalItems: 1, filters: ['userId'] } });
    expect(result.data[0]?.user).toEqual({ userId: expect.any(String), username: 'ana', fullName: 'Ana Pérez' });
  });
});

describe('GetUserConsentHistory', () => {
  it('historial del usuario; sin consentimientos → ConsentHistoryNotFoundError', async () => {
    const consents = new InMemoryUserConsents([userConsent({ userId: 'u-1' })]);
    const audit = new RecordingAuditTrail();
    const useCase = new GetUserConsentHistory(consents, audit);

    await expect(useCase.execute({ actorId: 'a', userId: 'u-1', query: PAGE })).resolves.toMatchObject({ data: [expect.any(Object)] });
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_HISTORY_VIEWED', entityId: 'u-1' });
    await expect(useCase.execute({ actorId: 'a', userId: 'otro', query: PAGE })).rejects.toBeInstanceOf(ConsentHistoryNotFoundError);
  });
});

describe('GrantPrivacyPolicyConsent / GrantCommercialCommunicationsConsent', () => {
  it('sin privacyPolicyId usa la política vigente; con null no asocia ninguna', async () => {
    const consents = new InMemoryUserConsents();
    const useCase = new GrantPrivacyPolicyConsent(
      new InMemoryConsentTypes([PRIVACY]),
      consents,
      new InMemoryPrivacyPolicies([privacyPolicy({ privacyPolicyId: 'pp-vigente' })])
    );

    await useCase.execute({ userId: 'u-1', ip: '1.1.1.1' });
    await useCase.execute({ userId: 'u-1', privacyPolicyId: null });
    expect(consents.grants.map(g => g.privacyPolicyId)).toEqual(['pp-vigente', null]);
    expect(consents.grants[0]).toMatchObject({ consentTypeId: 'ct-pp', ip: '1.1.1.1', userAgent: null });
  });

  it('si el tipo no está configurado devuelve null sin fallar', async () => {
    const types = new InMemoryConsentTypes();
    const consents = new InMemoryUserConsents();
    await expect(new GrantPrivacyPolicyConsent(types, consents, new InMemoryPrivacyPolicies()).execute({ userId: 'u' })).resolves.toBeNull();
    await expect(new GrantCommercialCommunicationsConsent(types, consents).execute({ userId: 'u' })).resolves.toBeNull();
    expect(consents.grants).toEqual([]);
  });

  it('comunicaciones comerciales: sin política asociada', async () => {
    const consents = new InMemoryUserConsents();
    await new GrantCommercialCommunicationsConsent(new InMemoryConsentTypes([MARKETING]), consents).execute({ userId: 'u-1' });
    expect(consents.grants[0]).toMatchObject({ consentTypeId: 'ct-mk', privacyPolicyId: null });
  });
});

describe('VerifyConsent', () => {
  const setup = (consents: InMemoryUserConsents) => {
    const audit = new RecordingAuditTrail();
    return { audit, useCase: new VerifyConsent(new InMemoryConsentTypes([PRIVACY, MARKETING]), consents, audit, silentLogger) };
  };

  it('consentimiento vigente → pasa y audita OK', async () => {
    const { audit, useCase } = setup(new InMemoryUserConsents([userConsent({ userId: 'u-1', consentTypeId: 'ct-pp', userConsentId: 'uc-9' })]));
    await expect(useCase.execute({ userId: 'u-1', consentTypeCode: 'PRIVACY_POLICY' })).resolves.toBeUndefined();
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_VERIFIED_OK', entityId: 'uc-9' });
  });

  it('sin consentimiento vigente (o revocado) → ConsentRequiredError y audita la falla', async () => {
    const { audit, useCase } = setup(new InMemoryUserConsents([userConsent({ userId: 'u-1', consentTypeId: 'ct-pp', revokedAt: new Date() })]));
    await expect(useCase.execute({ userId: 'u-1', consentTypeCode: 'PRIVACY_POLICY' })).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(audit.entries[0]).toMatchObject({ action: 'CONSENT_VERIFIED_FAIL', outcome: 'failure', details: { reason: 'no_valid_consent' } });
  });

  it('tipo no configurado → ConsentTypeNotConfiguredError; tipo opcional → error de configuración', async () => {
    const { audit, useCase } = setup(new InMemoryUserConsents());
    await expect(useCase.execute({ userId: 'u', consentTypeCode: 'NOPE' })).rejects.toBeInstanceOf(ConsentTypeNotConfiguredError);
    expect(audit.entries[0]).toMatchObject({ details: { reason: 'consent_type_not_found' } });
    await expect(useCase.execute({ userId: 'u', consentTypeCode: 'COMUNICACIONES_COMERCIALES' })).rejects.toBeInstanceOf(OptionalConsentGateError);
  });
});
