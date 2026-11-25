// tests/doubles/legal.doubles.ts
//
// Dobles en memoria de los puertos de legal, para los tests de los casos de uso (sin jest.mock, sin Prisma,
// sin S3), y fábricas de entidades de ejemplo.
import type { PageRequest } from '../../src/shared/application/pagination';
import type { UnitOfWork } from '../../src/shared/application/ports/unit-of-work.port';
import type { ConsentTypeRepository } from '../../src/modules/legal/application/ports/consent-type-repository.port';
import type { PrivacyPolicyFilters, PrivacyPolicyRepository } from '../../src/modules/legal/application/ports/privacy-policy-repository.port';
import type { UserConsentAdminFilters, UserConsentRepository } from '../../src/modules/legal/application/ports/user-consent-repository.port';
import type { PolicyDocumentStorage } from '../../src/modules/legal/application/ports/policy-document-storage.port';
import type { ActivePrivacyPolicyCache } from '../../src/modules/legal/application/ports/active-privacy-policy-cache.port';
import { ConsentType, type ConsentTypeChanges, type ConsentTypeProps, type NewConsentType } from '../../src/modules/legal/domain/consent-type';
import { PrivacyPolicy, type NewPrivacyPolicyVersion, type PrivacyPolicyProps } from '../../src/modules/legal/domain/privacy-policy';
import { UserConsent, type ConsentGrant, type ConsentRevocation, type UserConsentProps } from '../../src/modules/legal/domain/user-consent';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const AT = new Date('2026-01-01T00:00:00Z');

export const consentType = (over: Partial<ConsentTypeProps> = {}) =>
  ConsentType.restore({
    consentTypeId: ID,
    code: 'PRIVACY_POLICY',
    name: 'Política de privacidad',
    description: null,
    isMandatory: true,
    isRevocable: false,
    isActive: true,
    scope: 'ONBOARDING',
    createdAt: AT,
    updatedAt: AT,
    ...over
  });

export const privacyPolicy = (over: Partial<PrivacyPolicyProps> = {}) =>
  PrivacyPolicy.restore({
    privacyPolicyId: ID,
    version: '1.0',
    documentUrl: 'https://cdn.test/legal/privacy-policy-v1-0.pdf',
    documentHash: 'abc',
    summary: null,
    isActive: true,
    effectiveDate: AT,
    createdAt: AT,
    updatedAt: AT,
    ...over
  });

/** Un consentimiento; con `withRefs` trae tipo, política y titular (como la consulta admin). */
export const userConsent = ({ withRefs = false, ...over }: Partial<UserConsentProps> & { withRefs?: boolean } = {}) =>
  UserConsent.restore({
    userConsentId: ID,
    userId: ID,
    consentTypeId: ID,
    privacyPolicyId: ID,
    grantedAt: AT,
    grantedIp: '1.1.1.1',
    revokedAt: null,
    revocationReason: null,
    isCurrent: true,
    originSessionId: ID,
    createdAt: AT,
    ...(withRefs
      ? {
          consentType: { consentTypeId: ID, code: 'PRIVACY_POLICY', name: 'Política', isMandatory: true, isRevocable: false },
          privacyPolicy: { privacyPolicyId: ID, version: '1.0', documentUrl: 'https://cdn.test/p.pdf', effectiveDate: AT },
          holder: { userId: ID, username: 'ana', firstName: 'Ana', lastName: 'Pérez' }
        }
      : {}),
    ...over
  });

const paginate = <T>(items: T[], page: PageRequest) => ({ rows: items.slice(page.offset, page.offset + page.limit), count: items.length });

export class InMemoryConsentTypes implements ConsentTypeRepository {
  constructor(public types: ConsentType[] = []) {}
  readonly lastList: Array<{ page: PageRequest; search: string | null }> = [];
  private seq = 0;

  async findById(id: string) {
    return this.types.find(t => t.consentTypeId === id) ?? null;
  }
  async findActiveByCode(code: string) {
    return this.types.find(t => t.code === code && t.isActive) ?? null;
  }
  async existsWithCode(code: string) {
    return this.types.some(t => t.code === code);
  }
  async listActive() {
    return this.types.filter(t => t.isActive);
  }
  async list(page: PageRequest, search: string | null) {
    this.lastList.push({ page, search });
    return paginate(this.types, page);
  }
  async create(type: NewConsentType) {
    const created = consentType({ ...type, consentTypeId: `ct-${++this.seq}`, scope: 'ONBOARDING' });
    this.types.push(created);
    return created;
  }
  async update(id: string, changes: ConsentTypeChanges) {
    const current = await this.findById(id);
    if (!current) {
      return null;
    }
    const updated = consentType({ ...current, ...changes });
    this.types = this.types.map(t => (t.consentTypeId === id ? updated : t));
    return updated;
  }
}

export class InMemoryPrivacyPolicies implements PrivacyPolicyRepository {
  constructor(public policies: PrivacyPolicy[] = []) {}
  readonly lastList: Array<{ filters: PrivacyPolicyFilters; search: string | null }> = [];

  async findActive() {
    return this.policies.find(p => p.isActive) ?? null;
  }
  async findById(id: string) {
    return this.policies.find(p => p.privacyPolicyId === id) ?? null;
  }
  async versionExists(version: string) {
    return this.policies.some(p => p.version === version);
  }
  async list(filters: PrivacyPolicyFilters, page: PageRequest, search: string | null) {
    this.lastList.push({ filters, search });
    return paginate(
      this.policies.filter(p => filters.isActive === undefined || p.isActive === filters.isActive),
      page
    );
  }
  async publish(version: NewPrivacyPolicyVersion) {
    this.policies = this.policies.map(p => privacyPolicy({ ...p, isActive: false }));
    const created = privacyPolicy({ ...version, privacyPolicyId: `pp-${this.policies.length + 1}`, isActive: true });
    this.policies.push(created);
    return created;
  }
}

export class InMemoryUserConsents implements UserConsentRepository {
  constructor(public consents: UserConsent[] = []) {}
  readonly grants: ConsentGrant[] = [];
  readonly lastAdminFilters: UserConsentAdminFilters[] = [];

  async findCurrentByUser(userId: string) {
    return this.consents.filter(c => c.userId === userId && c.isCurrent);
  }
  async findCurrentByUserAndType(userId: string, consentTypeId: string) {
    return this.consents.find(c => c.userId === userId && c.consentTypeId === consentTypeId && c.isCurrent) ?? null;
  }
  async listHistoryByUser(userId: string, page: PageRequest) {
    return paginate(
      this.consents.filter(c => c.userId === userId),
      page
    );
  }
  async listForAdmin(filters: UserConsentAdminFilters, page: PageRequest) {
    this.lastAdminFilters.push(filters);
    return paginate(this.consents, page);
  }
  async grant(grant: ConsentGrant) {
    this.grants.push(grant);
    this.consents = this.consents.map(c =>
      c.userId === grant.userId && c.consentTypeId === grant.consentTypeId ? userConsent({ ...c, isCurrent: false }) : c
    );
    const created = userConsent({
      userConsentId: `uc-${this.grants.length}`,
      userId: grant.userId,
      consentTypeId: grant.consentTypeId,
      privacyPolicyId: grant.privacyPolicyId,
      grantedIp: grant.ip
    });
    this.consents.push(created);
    return created;
  }
  async findByIds(ids: readonly string[]) {
    return this.consents.filter(c => ids.includes(c.userConsentId));
  }
  async revokeAll(userId: string) {
    const current = this.consents.filter(c => c.userId === userId && c.isCurrent);
    this.consents = this.consents.map(c => (current.includes(c) ? userConsent({ ...c, isCurrent: false, revokedAt: new Date(), revocationReason: 'right_to_erasure' }) : c));
    return current.length;
  }
  async revokeCurrent({ userId, consentTypeId, reason }: ConsentRevocation) {
    const current = await this.findCurrentByUserAndType(userId, consentTypeId);
    if (!current) {
      return null;
    }
    const revoked = userConsent({ ...current, isCurrent: false, revokedAt: new Date(), revocationReason: reason });
    this.consents = this.consents.map(c => (c === current ? revoked : c));
    return revoked;
  }
}

/** Unidad de trabajo en memoria: cuenta las corridas y, si `work` falla, el error se propaga igual. */
export class CountingUnitOfWork implements UnitOfWork {
  runs = 0;
  async run<T>(work: () => PromiseLike<T>) {
    this.runs++;
    return work();
  }
}

export class InMemoryPolicyDocuments implements PolicyDocumentStorage {
  readonly published: Array<{ key: string; size: number }> = [];
  async publish(key: string, content: Uint8Array) {
    this.published.push({ key, size: content.byteLength });
    return { url: `https://cdn.test/${key}`, sha256: `sha-of-${content.byteLength}` };
  }
}

export class CountingPolicyCache implements ActivePrivacyPolicyCache {
  invalidations = 0;
  async invalidate() {
    this.invalidations++;
  }
}
