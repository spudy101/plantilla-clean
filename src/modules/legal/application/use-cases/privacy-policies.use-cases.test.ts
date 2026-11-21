// Casos de uso del mantenedor de políticas de privacidad, con dobles en memoria (sin S3 ni Redis).
import { ListPrivacyPolicies } from './list-privacy-policies.use-case';
import { GetPrivacyPolicy } from './get-privacy-policy.use-case';
import { PublishPrivacyPolicy, PRIVACY_POLICY_UPDATE_NOTIFICATION } from './publish-privacy-policy.use-case';
import { PolicyDocumentRequiredError, PrivacyPolicyNotFoundError, PrivacyPolicyVersionTakenError } from '../../domain/errors';
import { RecordingAuditTrail, RecordingNotifier, silentLogger } from '../../../../../tests/doubles/settings.doubles';
import {
  CountingPolicyCache,
  InMemoryPolicyDocuments,
  InMemoryPrivacyPolicies,
  privacyPolicy
} from '../../../../../tests/doubles/legal.doubles';

const PAGE = { page: 1, limit: 10, sortBy: 'createdAt', order: 'DESC' as const };
const flush = () => new Promise<void>(resolve => {
  setImmediate(resolve);
});
const PDF = new Uint8Array([37, 80, 68, 70]);

describe('ListPrivacyPolicies', () => {
  it('filtra por estado, audita y devuelve { data, metadata } con los filtros aplicados', async () => {
    const policies = new InMemoryPrivacyPolicies([privacyPolicy(), privacyPolicy({ privacyPolicyId: 'old', version: '0.9', isActive: false })]);
    const audit = new RecordingAuditTrail();
    const result = await new ListPrivacyPolicies(policies, audit).execute({ actorId: 'a', query: { ...PAGE, isActive: true } });

    expect(result.data.map(p => p.version)).toEqual(['1.0']);
    expect(result.metadata.filters).toEqual({ isActive: true });
    expect(audit.entries[0]).toMatchObject({ action: 'PRIVACY_POLICY_LIST_VIEWED', details: { totalItems: 1, page: 1 } });
  });

  it('isActive null se trata como "sin filtro"', async () => {
    const policies = new InMemoryPrivacyPolicies();
    await new ListPrivacyPolicies(policies, new RecordingAuditTrail()).execute({ actorId: 'a', query: { ...PAGE, isActive: null } });
    expect(policies.lastList[0]?.filters).toEqual({ isActive: undefined });
  });
});

describe('GetPrivacyPolicy', () => {
  it('detalle con la URL del PDF; inexistente → PrivacyPolicyNotFoundError', async () => {
    const policies = new InMemoryPrivacyPolicies([privacyPolicy()]);
    const audit = new RecordingAuditTrail();
    const useCase = new GetPrivacyPolicy(policies, audit);

    await expect(useCase.execute({ actorId: 'a', privacyPolicyId: privacyPolicy().privacyPolicyId })).resolves.toMatchObject({
      documentUrl: privacyPolicy().documentUrl
    });
    expect(audit.entries[0]).toMatchObject({ action: 'PRIVACY_POLICY_DETAIL_VIEWED', details: { version: '1.0' } });
    await expect(useCase.execute({ actorId: 'a', privacyPolicyId: 'x' })).rejects.toBeInstanceOf(PrivacyPolicyNotFoundError);
  });
});

describe('PublishPrivacyPolicy', () => {
  const setup = (existing = [privacyPolicy()]) => {
    const policies = new InMemoryPrivacyPolicies(existing);
    const documents = new InMemoryPolicyDocuments();
    const cache = new CountingPolicyCache();
    const audit = new RecordingAuditTrail();
    const notifier = new RecordingNotifier();
    return {
      policies,
      documents,
      cache,
      audit,
      notifier,
      useCase: new PublishPrivacyPolicy(policies, documents, cache, audit, notifier, silentLogger)
    };
  };

  it('publica el PDF en su ruta, invalida la caché, deja la nueva como única vigente, audita y avisa a todos', async () => {
    const { useCase, policies, documents, cache, audit, notifier } = setup();
    const result = await useCase.execute({ actorId: 'admin-1', version: '1.1', document: PDF, effectiveDate: new Date('2026-03-01T00:00:00Z') });
    await flush();

    expect(documents.published).toEqual([{ key: 'legal/privacy-policy-v1-1.pdf', size: 4 }]);
    expect(cache.invalidations).toBe(1);
    expect(policies.policies.filter(p => p.isActive).map(p => p.version)).toEqual(['1.1']);
    expect(result).toMatchObject({ version: '1.1', isActive: true, summary: null, documentUrl: 'https://cdn.test/legal/privacy-policy-v1-1.pdf' });
    expect(policies.policies.at(-1)?.documentHash).toBe('sha-of-4');
    expect(audit.entries[0]).toMatchObject({
      action: 'PRIVACY_POLICY_VERSION_CREATED',
      details: { version: '1.1', s3Key: 'legal/privacy-policy-v1-1.pdf' }
    });
    expect(notifier.sent).toEqual([
      expect.objectContaining({
        type: PRIVACY_POLICY_UPDATE_NOTIFICATION,
        userId: null,
        metadata: expect.objectContaining({ nuevaVersion: '1.1', fechaVigencia: '2026-03-01' })
      })
    ]);
  });

  it('sin PDF → PolicyDocumentRequiredError (no consulta nada)', async () => {
    const { useCase, documents } = setup();
    await expect(useCase.execute({ actorId: 'a', version: '2.0', document: null })).rejects.toBeInstanceOf(PolicyDocumentRequiredError);
    expect(documents.published).toEqual([]);
  });

  it('versión existente → PrivacyPolicyVersionTakenError, sin subir nada', async () => {
    const { useCase, documents, cache } = setup();
    await expect(useCase.execute({ actorId: 'a', version: '1.0', document: PDF })).rejects.toBeInstanceOf(PrivacyPolicyVersionTakenError);
    expect(documents.published).toEqual([]);
    expect(cache.invalidations).toBe(0);
  });
});
