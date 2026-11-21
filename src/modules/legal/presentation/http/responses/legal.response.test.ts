// Conformidad: la salida de los casos de uso de legal cumple los esquemas que documenta Swagger.
import {
  ConsentGrantedSchema,
  ConsentTypeDetailSchema,
  ConsentTypeListItemSchema,
  MyConsentCatalogItemSchema,
  PrivacyPolicyDetailSchema,
  PrivacyPolicyItemSchema,
  UserConsentSchema
} from './legal.response';
import { toConsentTypeDetailOutput, toConsentTypeListItemOutput } from '../../../application/dto/consent-type.output';
import {
  toGrantedConsentOutput,
  toMyConsentCatalogItemOutput,
  toUserConsentOutput
} from '../../../application/dto/user-consent.output';
import {
  toPrivacyPolicyDetailOutput,
  toPrivacyPolicyItemOutput,
  toPublishedPrivacyPolicyOutput
} from '../../../application/dto/privacy-policy.output';
import { consentType, privacyPolicy, userConsent } from '../../../../../../tests/doubles/legal.doubles';

const ok = (schema: { strict(): { safeParse(v: unknown): { error?: { issues: unknown[] } } } }, value: unknown) =>
  expect(schema.strict().safeParse(value).error?.issues ?? []).toEqual([]);

describe('Legal — salida conforme al esquema', () => {
  it('tipos de consentimiento (lista y detalle)', () => {
    ok(ConsentTypeListItemSchema, toConsentTypeListItemOutput(consentType()));
    ok(ConsentTypeDetailSchema, toConsentTypeDetailOutput(consentType()));
  });

  it('consentimientos: admin, otorgado y catálogo (con y sin otorgamiento)', () => {
    const consent = userConsent({ withRefs: true });
    ok(UserConsentSchema, toUserConsentOutput(consent));
    ok(ConsentGrantedSchema, toGrantedConsentOutput(consent));
    ok(MyConsentCatalogItemSchema, toMyConsentCatalogItemOutput(consentType(), consent));
    ok(MyConsentCatalogItemSchema, toMyConsentCatalogItemOutput(consentType(), null));
  });

  it('consentimiento sin referencias (hidratación por id): tipo, política y titular en null', () => {
    const value = toUserConsentOutput(userConsent());
    ok(UserConsentSchema, value);
    expect(value).toMatchObject({ user: null, consentType: null, privacyPolicy: null });
  });

  it('políticas de privacidad: ítem, detalle y publicada', () => {
    ok(PrivacyPolicyItemSchema, toPrivacyPolicyItemOutput(privacyPolicy()));
    ok(PrivacyPolicyDetailSchema, toPrivacyPolicyDetailOutput(privacyPolicy()));
    ok(PrivacyPolicyDetailSchema, toPublishedPrivacyPolicyOutput(privacyPolicy()));
  });
});
