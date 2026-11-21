// Reglas del dominio legal: TypeScript puro, sin mocks.
import { ConsentType, normalizeConsentTypeCode } from './consent-type';
import { PrivacyPolicy } from './privacy-policy';
import { holderFullName } from './user-consent';
import { ConsentNotRevocableError, OptionalConsentGateError } from './errors';
import { consentType, userConsent } from '../../../../tests/doubles/legal.doubles';

describe('ConsentType', () => {
  it('define: código en mayúsculas, obligatorio y no revocable por defecto, nace activo', () => {
    expect(ConsentType.define({ code: 'terms_v2', name: 'Términos' })).toEqual({
      code: 'TERMS_V2',
      name: 'Términos',
      description: null,
      isMandatory: true,
      isRevocable: false,
      isActive: true
    });
  });

  it('define: respeta opcional y revocable si se piden', () => {
    expect(ConsentType.define({ code: 'MKT', name: 'Marketing', isMandatory: false, isRevocable: true })).toMatchObject({
      isMandatory: false,
      isRevocable: true
    });
  });

  it('normaliza el código', () => {
    expect(normalizeConsentTypeCode('abc')).toBe('ABC');
  });

  it('changesFor: lo que no viene conserva su valor; description null sí se aplica', () => {
    const type = consentType({ name: 'A', description: 'd', isActive: true });
    expect(type.changesFor({})).toEqual({ name: 'A', description: 'd', isActive: true });
    expect(type.changesFor({ name: 'B', description: null, isActive: false })).toEqual({ name: 'B', description: null, isActive: false });
  });

  it('assertRevocable: solo los revocables', () => {
    expect(() => consentType({ isRevocable: false }).assertRevocable()).toThrow(ConsentNotRevocableError);
    expect(() => consentType({ isRevocable: true }).assertRevocable()).not.toThrow();
  });

  it('assertCanGateAccess: un consentimiento opcional nunca puede ser condición de acceso', () => {
    expect(() => consentType({ isMandatory: false }).assertCanGateAccess()).toThrow(OptionalConsentGateError);
    expect(() => consentType({ isMandatory: true }).assertCanGateAccess()).not.toThrow();
  });
});

describe('PrivacyPolicy', () => {
  it('la ruta del PDF es predecible a partir de la versión', () => {
    expect(PrivacyPolicy.documentKey('1.1')).toBe('legal/privacy-policy-v1-1.pdf');
    expect(PrivacyPolicy.documentKey('10.0')).toBe('legal/privacy-policy-v10-0.pdf');
  });
});

describe('UserConsent', () => {
  it('vale mientras no se revoque', () => {
    expect(userConsent().isInForce()).toBe(true);
    expect(userConsent({ revokedAt: new Date() }).isInForce()).toBe(false);
  });

  it('nombre del titular', () => {
    expect(holderFullName({ userId: 'u', username: 'a', firstName: 'Ana', lastName: 'Pérez' })).toBe('Ana Pérez');
    expect(holderFullName({ userId: 'u', username: 'a', firstName: null, lastName: null })).toBeNull();
  });
});
