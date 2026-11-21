// Casos de uso de catálogos con dobles en memoria de sus puertos: sin jest.mock, sin Prisma, sin Redis.
import { ListCatalog } from './list-catalog.use-case';
import { ListClientDocumentTypes } from './list-client-document-types.use-case';
import {
  GetActivePrivacyPolicy,
  PRIVACY_POLICY_CACHE_KEY,
  PRIVACY_POLICY_CACHE_TTL_SECONDS
} from './get-active-privacy-policy.use-case';
import { toCountryOutput, toGenderOutput } from '../dto/catalog.output';
import { ActivePrivacyPolicyNotFoundError } from '../../domain/errors';
import type { Country, Gender } from '../../domain/catalog-entries';
import { RecordingAuditTrail } from '../../../../../tests/doubles/settings.doubles';
import {
  InMemoryCache,
  InMemoryCatalog,
  InMemoryDocumentTypes,
  InMemoryPrivacyPolicies
} from '../../../../../tests/doubles/catalogs.doubles';

const at = new Date('2026-01-01T00:00:00Z');
const gender = (genderId: string, name: string, isActive = true): Gender => ({
  genderId,
  name,
  isActive,
  createdAt: at,
  updatedAt: at
});
const page = { page: 1, limit: 2, sortBy: 'name', order: 'ASC' as const };

describe('ListCatalog', () => {
  const genders = [gender('g1', 'Femenino'), gender('g2', 'Masculino'), gender('g3', 'No binario'), gender('g4', 'Otro', false)];

  it('pagina, aplica filtros y búsqueda, y arma la metadata con lo aplicado', async () => {
    const catalog = new InMemoryCatalog(genders);
    const audit = new RecordingAuditTrail();
    const useCase = new ListCatalog(catalog, audit, 'MAINTAINER_GENDERS_VIEWED', toGenderOutput);

    const result = await useCase.execute({ page, filters: { isActive: true } });

    expect(result.data.map(g => g.genderId)).toEqual(['g1', 'g2']);
    expect(result.metadata).toEqual({
      pagination: { currentPage: 1, pageSize: 2, totalItems: 3, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
      sort: { field: 'name', order: 'ASC' },
      filters: { isActive: true }
    });
    expect(catalog.calls[0]?.page.offset).toBe(0);
  });

  it('audita la consulta con el total y la página (actor null: la ruta es pública)', async () => {
    const audit = new RecordingAuditTrail();
    await new ListCatalog(new InMemoryCatalog(genders), audit, 'MAINTAINER_GENDERS_VIEWED', toGenderOutput).execute({
      page,
      search: 'mas',
      filters: {}
    });

    expect(audit.entries).toEqual([
      {
        action: 'MAINTAINER_GENDERS_VIEWED',
        actorId: null,
        details: { totalItems: 1, page: 1 },
        entityType: 'Catalog',
        entityTable: null
      }
    ]);
  });

  it('la búsqueda sale en los filtros aplicados de la metadata', async () => {
    const country: Country = {
      countryId: 'co',
      name: 'Colombia',
      code: 'COL',
      iconUrl: '',
      isActive: true,
      createdAt: at,
      updatedAt: at
    };
    const result = await new ListCatalog(
      new InMemoryCatalog([country]),
      new RecordingAuditTrail(),
      'MAINTAINER_COUNTRIES_VIEWED',
      toCountryOutput
    ).execute({
      page,
      search: 'col',
      filters: { isActive: undefined }
    });

    expect(result.metadata.filters).toEqual({ search: 'col' });
    expect(result.data[0]?.iconUrl).toBeNull(); // '' → null
  });
});

describe('ListClientDocumentTypes', () => {
  it('solo los visibles y activos, con metadata de una sola página', async () => {
    const documentTypes = new InMemoryDocumentTypes([
      { documentTypeId: 'd1', code: 'CC', name: 'Cédula', isVisibleToClient: true, isActive: true },
      { documentTypeId: 'd2', code: 'SYSTEM', name: 'Sistema', isVisibleToClient: false, isActive: true },
      { documentTypeId: 'd3', code: 'TI', name: 'Tarjeta', isVisibleToClient: true, isActive: false }
    ]);
    const audit = new RecordingAuditTrail();

    const result = await new ListClientDocumentTypes(documentTypes, audit).execute();

    expect(result.data.map(d => d.code)).toEqual(['CC']);
    expect(result.metadata.pagination).toMatchObject({ currentPage: 1, pageSize: 1, totalItems: 1, totalPages: 1 });
    expect(audit.entries[0]).toMatchObject({ action: 'MAINTAINER_DOCUMENT_TYPES_VIEWED', details: { totalItems: 1 } });
  });
});

describe('GetActivePrivacyPolicy', () => {
  const policy = { version: '2.0', documentUrl: 'https://cdn.test/politica.pdf', summary: '', effectiveDate: at };

  it('sin caché: la lee, la guarda 12 h y audita', async () => {
    const cache = new InMemoryCache();
    const audit = new RecordingAuditTrail();

    const result = await new GetActivePrivacyPolicy(new InMemoryPrivacyPolicies(policy), cache, audit).execute();

    expect(result).toEqual({ version: '2.0', documentUrl: 'https://cdn.test/politica.pdf', summary: null, effectiveDate: at });
    expect(cache.store.get(PRIVACY_POLICY_CACHE_KEY)).toEqual(result);
    expect(cache.ttls.get(PRIVACY_POLICY_CACHE_KEY)).toBe(PRIVACY_POLICY_CACHE_TTL_SECONDS);
    expect(audit.entries).toEqual([expect.objectContaining({ action: 'PRIVACY_POLICY_VIEWED', details: { version: '2.0' } })]);
  });

  it('con caché: no lee la base pero audita igual', async () => {
    const cache = new InMemoryCache();
    cache.set(PRIVACY_POLICY_CACHE_KEY, { version: '1.0', documentUrl: 'x', summary: null, effectiveDate: at.toISOString() });
    const policies = new InMemoryPrivacyPolicies(policy);
    const audit = new RecordingAuditTrail();

    const result = await new GetActivePrivacyPolicy(policies, cache, audit).execute();

    expect(result.version).toBe('1.0');
    expect(policies.reads).toBe(0);
    expect(audit.entries).toEqual([expect.objectContaining({ action: 'PRIVACY_POLICY_VIEWED', details: { version: '1.0' } })]);
  });

  it('sin política activa lanza ActivePrivacyPolicyNotFoundError', async () => {
    const useCase = new GetActivePrivacyPolicy(new InMemoryPrivacyPolicies(null), new InMemoryCache(), new RecordingAuditTrail());
    await expect(useCase.execute()).rejects.toBeInstanceOf(ActivePrivacyPolicyNotFoundError);
  });
});
