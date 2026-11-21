// tests/unit/modules/shared-endpoints/kyc/maintainers/services/maintainers.service.test.ts
//
// MaintainersService — catálogos públicos (géneros, tipos de documento, prefijos, avatares, países,
// roles, tipos de notificación) + política de privacidad activa con caché Redis. Aislamos todos los
// repositorios, la paginación, Redis y los DTOs (passthrough) para probar: el helper genérico _list
// (arma filtros/metadata, pagina, audita, mapea al DTO), la rama especial de tipos de documento, y
// las tres ramas de getActivePrivacyPolicy (cache hit / cache miss con política / sin política →
// AppError.notFound). Se usa el AppError real para assertar statusCode.

jest.mock('../repositories/gender.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../repositories/document-type.repository', () => ({
  findAllVisibleToClient: jest.fn()
}));
jest.mock('../repositories/phone-prefix.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../repositories/avatar.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../repositories/avatar-theme.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../repositories/country.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../repositories/department.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../repositories/city.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../../legal/repositories/privacy-policy.repository', () => ({ findActive: jest.fn() }));
jest.mock('../../iam/repositories/role.repository', () => ({ findAllPaginated: jest.fn() }));
jest.mock('../../notification/repositories/notification-type.repository', () => ({ findAllPaginated: jest.fn() }));

jest.mock('../../../shared/observability/logger.util', () => ({ logAudit: jest.fn() }));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));
jest.mock('../../../shared/infra/redis.util', () => ({ get: jest.fn(), set: jest.fn() }));

// DTOs a passthrough: devuelven { rows, metadata } para verificar qué recibió cada uno.
jest.mock('../responses/maintainers.response', () => ({
  ListGendersResponseDTO: jest.fn((rows, metadata) => ({ dto: 'genders', rows, metadata })),
  ListDocumentTypesResponseDTO: jest.fn((rows, metadata) => ({ dto: 'documentTypes', rows, metadata })),
  ListPhonePrefixesResponseDTO: jest.fn((rows, metadata) => ({ dto: 'phonePrefixes', rows, metadata })),
  ListAvatarsResponseDTO: jest.fn((rows, metadata) => ({ dto: 'avatars', rows, metadata })),
  ListAvatarThemesResponseDTO: jest.fn((rows, metadata) => ({ dto: 'avatarThemes', rows, metadata })),
  ListCountriesResponseDTO: jest.fn((rows, metadata) => ({ dto: 'countries', rows, metadata })),
  ListDepartmentsResponseDTO: jest.fn((rows, metadata) => ({ dto: 'departments', rows, metadata })),
  ListCitiesResponseDTO: jest.fn((rows, metadata) => ({ dto: 'cities', rows, metadata })),
  ActivePrivacyPolicyResponseDTO: jest.fn(policy => ({ dto: 'privacyPolicy', version: policy.version })),
  ListRolesResponseDTO: jest.fn((rows, metadata) => ({ dto: 'roles', rows, metadata })),
  ListNotificationTypesResponseDTO: jest.fn((rows, metadata) => ({ dto: 'notificationTypes', rows, metadata }))
}));

import { mocked } from 'tests/helpers/mock';
import genderRepositoryModule from '../repositories/gender.repository';
const genderRepository = mocked(genderRepositoryModule);
import documentTypeRepositoryModule from '../repositories/document-type.repository';
const documentTypeRepository = mocked(documentTypeRepositoryModule);
import phonePrefixRepositoryModule from '../repositories/phone-prefix.repository';
const phonePrefixRepository = mocked(phonePrefixRepositoryModule);
import privacyPolicyRepositoryModule from '../../legal/repositories/privacy-policy.repository';
const privacyPolicyRepository = mocked(privacyPolicyRepositoryModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import redisClientModule from '../../../shared/infra/redis.util';
const redisClient = mocked(redisClientModule);
import AppError from '../../../shared/http/app-error.util';
import service from './maintainers.service';
import { GenderListQuery, PhonePrefixListQuery } from '../requests/maintainers.request';

describe('MaintainersService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('_list (vía listGenders)', () => {
    it('pagina, arma metadata, audita y mapea al DTO', async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      genderRepository.findAllPaginated.mockResolvedValue({ rows, count: 25 });

      const result = await service.listGenders(GenderListQuery.parse({ page: '2', sortBy: 'name', order: 'asc', isActive: 'true' }), 'user-1');

      expect(genderRepository.findAllPaginated).toHaveBeenCalledWith(
        { isActive: true },
        { page: 2, limit: 10, offset: 10, sortBy: 'name', order: 'ASC' },
        undefined
      );
      expect(logAudit).toHaveBeenCalledWith('MAINTAINER_GENDERS_VIEWED', { actorId: 'user-1', details: { totalItems: 25, page: 2 }, entityType: 'Catalog', entityTable: null }
      );
      expect(result).toEqual({
        dto: 'genders',
        rows,
        metadata: {
          pagination: { currentPage: 2, pageSize: 10, totalItems: 25, totalPages: 3, hasNextPage: true, hasPreviousPage: true },
          sort: { field: 'name', order: 'ASC' },
          // Sin search, metadata.filters expone los filtros aplicados.
          filters: { isActive: true }
        }
      });
    });

    it('incluye el searchTerm en metadata.filters cuando viene query.search', async () => {
      phonePrefixRepository.findAllPaginated.mockResolvedValue({ rows: [], count: 0 });

      const result = await service.listPhonePrefixes(PhonePrefixListQuery.parse({ search: 'chile', isActive: 'true', page: '2' }));

      expect(phonePrefixRepository.findAllPaginated).toHaveBeenCalledWith(
        { isActive: true, countryId: undefined },
        expect.objectContaining({ sortBy: 'createdAt', order: 'DESC' }),
        'chile'
      );
      // userId por defecto es null en rutas públicas.
      expect(logAudit).toHaveBeenCalledWith('MAINTAINER_PHONE_PREFIXES_VIEWED', { actorId: null, details: { totalItems: 0, page: 2 }, entityType: 'Catalog', entityTable: null }
      );
      expect(result.metadata.filters).toEqual({ search: 'chile', isActive: true });
    });
  });

  describe('listDocumentTypes', () => {
    it('usa findAllVisibleToClient (sin paginación) y arma metadata a partir del total', async () => {
      const items = [{ documentTypeId: 'dt-1' }, { documentTypeId: 'dt-2' }];
      documentTypeRepository.findAllVisibleToClient.mockResolvedValue(items);

      const result = await service.listDocumentTypes('user-9');

      expect(documentTypeRepository.findAllVisibleToClient).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('MAINTAINER_DOCUMENT_TYPES_VIEWED', { actorId: 'user-9', details: { totalItems: 2 }, entityType: 'Catalog', entityTable: null }
      );
      expect(result).toEqual({
        dto: 'documentTypes',
        rows: items,
        metadata: {
          pagination: { currentPage: 1, pageSize: 2, totalItems: 2, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
          sort: { field: 'name', order: 'ASC' }
        }
      });
    });
  });

  describe('getActivePrivacyPolicy', () => {
    it('cache hit: devuelve lo cacheado, audita y NO pega a BD', async () => {
      const cached = { dto: 'privacyPolicy', version: 'v3' };
      redisClient.get.mockResolvedValue(cached);

      const result = await service.getActivePrivacyPolicy();

      expect(privacyPolicyRepository.findActive).not.toHaveBeenCalled();
      expect(redisClient.set).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('PRIVACY_POLICY_VIEWED', { actorId: null, details: { version: 'v3' }, entityType: 'Catalog', entityTable: null }
      );
      expect(result).toBe(cached);
    });

    it('cache miss con política: arma DTO, audita y cachea con TTL 12h', async () => {
      redisClient.get.mockResolvedValue(null);
      privacyPolicyRepository.findActive.mockResolvedValue({ version: 'v5' });

      const result = await service.getActivePrivacyPolicy();

      expect(result).toEqual({ dto: 'privacyPolicy', version: 'v5' });
      expect(redisClient.set).toHaveBeenCalledWith(
        'cache:privacy-policy:active',
        { dto: 'privacyPolicy', version: 'v5' },
        43200
      );
      expect(logAudit).toHaveBeenCalledWith('PRIVACY_POLICY_VIEWED', { actorId: null, details: { version: 'v5' }, entityType: 'Catalog', entityTable: null }
      );
    });

    it('cache miss sin política activa: lanza AppError.notFound (404)', async () => {
      redisClient.get.mockResolvedValue(null);
      privacyPolicyRepository.findActive.mockResolvedValue(null);

      await expect(service.getActivePrivacyPolicy()).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND'
      });
      expect(redisClient.set).not.toHaveBeenCalled();
      expect(AppError).toBeDefined();
    });
  });
});
