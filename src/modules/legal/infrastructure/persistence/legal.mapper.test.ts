// Mapper fila de Prisma ↔ entidades de legal.
import { LegalMapper, type UserConsentRowWithRefs } from './legal.mapper';

const AT = new Date('2026-01-01T00:00:00Z');
const row: UserConsentRowWithRefs = {
  userConsentId: 'uc-1',
  userId: 'u-1',
  consentTypeId: 'ct-1',
  privacyPolicyId: null,
  grantedAt: AT,
  grantedIp: '1.1.1.1',
  grantedUserAgent: 'jest',
  revokedAt: null,
  revokedIp: null,
  revocationReason: null,
  isCurrent: true,
  originSessionId: null,
  originCorrelationId: 'corr',
  createdAt: AT,
  updatedAt: AT
};

describe('LegalMapper.userConsentToDomain', () => {
  it('sin include: las referencias quedan ausentes (no null)', () => {
    const consent = LegalMapper.userConsentToDomain(row);
    expect(consent.userConsentId).toBe('uc-1');
    expect('consentType' in consent).toBe(false);
    expect('privacyPolicy' in consent).toBe(false);
    expect('holder' in consent).toBe(false);
  });

  it('con include: tipo (solo lo seleccionado), política (o null) y titular con su nombre', () => {
    const consent = LegalMapper.userConsentToDomain({
      ...row,
      consentType: { consentTypeId: 'ct-1', code: 'PRIVACY_POLICY', name: 'Política', isMandatory: true, isRevocable: false },
      privacyPolicy: null,
      user: { userId: 'u-1', username: 'ana', person: { firstName: 'Ana', lastName: null } }
    });
    expect(consent.consentType).toEqual({ consentTypeId: 'ct-1', code: 'PRIVACY_POLICY', name: 'Política', isMandatory: true, isRevocable: false });
    expect(consent.privacyPolicy).toBeNull();
    expect(consent.holder).toEqual({ userId: 'u-1', username: 'ana', firstName: 'Ana', lastName: null });
  });
});
