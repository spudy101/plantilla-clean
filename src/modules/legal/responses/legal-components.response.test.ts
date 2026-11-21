// La salida de cada constructor de legal cumple su esquema (y por lo tanto su documentación).
import { pageMetadata } from '../../../shared/application/pagination';
import components, {
  ConsentGrantedSchema,
  ConsentTypeDetailSchema,
  ConsentTypeListItemSchema,
  MyConsentCatalogItemSchema,
  MyConsentSchema,
  UserConsentSchema
} from './legal-components.response';
import policies, { PrivacyPolicyDetailSchema, PrivacyPolicyItemSchema } from './privacy-policy-admin.response';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const at = new Date('2026-01-01T00:00:00Z');
const consentType = { consentTypeId: ID, code: 'PRIVACY_POLICY', name: 'Política', description: null, isMandatory: true, isRevocable: false, isActive: true, scope: 'client', createdAt: at, updatedAt: at };
const policyRef = { privacyPolicyId: ID, version: '1.0', documentUrl: 'https://x/p.pdf', effectiveDate: at };
const consent = {
  userConsentId: ID,
  userId: ID,
  user: { userId: ID, username: 'ana', person: { firstName: 'Ana', lastName: 'Pérez' } },
  consentTypeId: ID,
  consentType,
  privacyPolicy: policyRef,
  grantedAt: at,
  grantedIp: '1.1.1.1',
  originSessionId: ID,
  revokedAt: null,
  revocationReason: null,
  isCurrent: true,
  createdAt: at
};
const policy = { privacyPolicyId: ID, version: '1.0', isActive: true, summary: null, documentUrl: 'https://x/p.pdf', effectiveDate: at, createdAt: at, updatedAt: at };

const ok = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) =>
  expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('esquemas de salida de legal', () => {
  it('tipos de consentimiento (lista y detalle)', () => {
    ok(ConsentTypeListItemSchema, components.ConsentTypeComponent.buildList(consentType));
    ok(ConsentTypeDetailSchema, components.ConsentTypeComponent.buildDetail(consentType));
  });

  it('consentimientos: admin, del propio usuario, otorgado y catálogo', () => {
    ok(UserConsentSchema, components.UserConsentComponent.build(consent));
    ok(MyConsentSchema, components.UserConsentComponent.buildForClient(consent));
    ok(ConsentGrantedSchema, components.UserConsentComponent.buildGranted(consent));
    ok(MyConsentCatalogItemSchema, components.UserConsentComponent.buildClientCatalogItem(consentType, consent));
    ok(MyConsentCatalogItemSchema, components.UserConsentComponent.buildClientCatalogItem(consentType, null));
  });

  it('políticas de privacidad: ítem, detalle y creada', () => {
    ok(PrivacyPolicyItemSchema, policies.ListPrivacyPoliciesResponseDTO([policy as never], pageMetadata({ page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' }, 1)).data[0]);
    ok(PrivacyPolicyDetailSchema, policies.PrivacyPolicyDetailResponseDTO(policy as never));
    ok(PrivacyPolicyDetailSchema, policies.PrivacyPolicyCreatedResponseDTO(policy as never));
  });
});
