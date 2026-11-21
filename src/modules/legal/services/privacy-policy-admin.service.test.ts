// tests/unit/modules/admin/records/legal/services/privacy-policy-admin.service.test.ts
//
// PrivacyPolicyAdminService — mantenedor de versiones de la política de privacidad. Probamos: listado
// paginado, detalle (404 + camino feliz) y creación de versión (conflicto por versión existente, camino
// feliz con upload a S3/invalidación CloudFront/purga Redis/hash SHA-256/notificación global, y la rama
// de warn si la notificación falla). Repos, S3, Redis, notificaciones y DTOs van mockeados.

jest.mock('../repositories/privacy-policy-admin.repository', () => ({
  findAllPaginated: jest.fn(),
  findById: jest.fn(),
  findByVersion: jest.fn(),
  createVersion: jest.fn()
}));

jest.mock('../../../shared/infrastructure/storage/s3.util', () => ({
  uploadPublicDocument: jest.fn().mockResolvedValue('https://cdn.test/legal/privacy-policy-v1-1.pdf'),
  invalidateCloudFront: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/cache/redis.util', () => ({ del: jest.fn().mockResolvedValue(1) }));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../responses/privacy-policy-admin.response', () => ({
  ListPrivacyPoliciesResponseDTO: jest.fn(() => ({ dto: 'list' })),
  PrivacyPolicyDetailResponseDTO: jest.fn(() => ({ dto: 'detail' })),
  PrivacyPolicyCreatedResponseDTO: jest.fn(() => ({ dto: 'created' }))
}));

import { mocked } from 'tests/helpers/mock';
import repoModule from '../repositories/privacy-policy-admin.repository';
const repo = mocked(repoModule);
import S3UtilModule from '../../../shared/infrastructure/storage/s3.util';
const S3Util = mocked(S3UtilModule);
import redisClientModule from '../../../shared/infrastructure/cache/redis.util';
const redisClient = mocked(redisClientModule);
import NotificationCreationServiceModule from '../../notification/notify';
const notifier = mocked(NotificationCreationServiceModule);
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
import auditServiceModule from '../../audit/audit.service';
const { logger } = mocked(loggerUtilModule);
const logAudit = mocked(auditServiceModule).record;
import privacyPolicyAdminDtoModuleModule from '../responses/privacy-policy-admin.response';
const privacyPolicyAdminDtoModule = mocked(privacyPolicyAdminDtoModuleModule);
const {
  ListPrivacyPoliciesResponseDTO,
  PrivacyPolicyDetailResponseDTO,
  PrivacyPolicyCreatedResponseDTO
} = mocked(privacyPolicyAdminDtoModule);
import service from './privacy-policy-admin.service';
import { PrivacyPolicyListQuery } from '../requests/legal.request';

const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

const USER_ID = 'admin-1';

describe('PrivacyPolicyAdminService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listVersions', () => {
    it('pagina, incluye search en filtros, audita y responde el DTO de lista', async () => {
      repo.findAllPaginated.mockResolvedValue({ rows: [{ id: 1 }], count: 1 });

      const result = await service.listVersions(PrivacyPolicyListQuery.parse({ search: 'v1', isActive: 'true' }), USER_ID);

      expect(repo.findAllPaginated).toHaveBeenCalledWith(
        { isActive: true },
        expect.objectContaining({ page: 1 }),
        'v1'
      );
      expect(ListPrivacyPoliciesResponseDTO).toHaveBeenCalledWith(
        [{ id: 1 }],
        expect.objectContaining({ sort: { field: 'createdAt', order: 'DESC' }, filters: { search: 'v1', isActive: true } })
      );
      expect(logAudit).toHaveBeenCalledWith('PRIVACY_POLICY_LIST_VIEWED', expect.objectContaining({ actorId: USER_ID, details: expect.objectContaining({ totalItems: 1 }) })
      );
      expect(result).toEqual({ dto: 'list' });
    });
  });

  describe('getVersionDetail', () => {
    it('lanza 404 cuando la versión no existe', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getVersionDetail('nope', USER_ID)).rejects.toThrow('no encontrada');
    });

    it('audita y devuelve el detalle', async () => {
      repo.findById.mockResolvedValue({ privacyPolicyId: 'p1', version: '1.0' });

      const result = await service.getVersionDetail('p1', USER_ID);

      expect(logAudit).toHaveBeenCalledWith('PRIVACY_POLICY_DETAIL_VIEWED', expect.objectContaining({ actorId: USER_ID, details: { version: '1.0' }, entityId: 'p1' })
      );
      expect(PrivacyPolicyDetailResponseDTO).toHaveBeenCalledWith({ privacyPolicyId: 'p1', version: '1.0' });
      expect(result).toEqual({ dto: 'detail' });
    });
  });

  describe('createVersion', () => {
    const baseData = () => ({
      version: '1.1',
      fileBuffer: Buffer.from('pdf-bytes'),
      _originalName: 'policy.pdf',
      summary: 'cambios menores',
      effectiveDate: new Date('2026-01-01')
    });

    it('lanza 409 si la versión ya existe', async () => {
      repo.findByVersion.mockResolvedValue({ privacyPolicyId: 'existente' });

      await expect(service.createVersion(baseData(), USER_ID)).rejects.toThrow('La versión 1.1 ya existe');
      expect(S3Util.uploadPublicDocument).not.toHaveBeenCalled();
    });

    it('sube el PDF, invalida caches, persiste con hash SHA-256, audita y notifica en background', async () => {
      repo.findByVersion.mockResolvedValue(null);
      repo.createVersion.mockResolvedValue({
        privacyPolicyId: 'p-new',
        effectiveDate: new Date('2026-01-01')
      });

      const result = await service.createVersion(baseData(), USER_ID);

      // Key predecible con la versión saneada (1.1 → 1-1)
      const expectedKey = 'legal/privacy-policy-v1-1.pdf';
      expect(S3Util.uploadPublicDocument).toHaveBeenCalledWith(expect.any(Buffer), expectedKey, 'application/pdf');
      expect(S3Util.invalidateCloudFront).toHaveBeenCalledWith(`/${expectedKey}`);
      expect(redisClient.del).toHaveBeenCalledWith('cache:privacy-policy:active');

      const created = repo.createVersion.mock.calls[0][0];
      expect(created).toMatchObject({
        version: '1.1',
        documentUrl: 'https://cdn.test/legal/privacy-policy-v1-1.pdf',
        summary: 'cambios menores'
      });
      // SHA-256 en hex son 64 caracteres.
      expect(created.documentHash).toMatch(/^[a-f0-9]{64}$/);

      expect(logAudit).toHaveBeenCalledWith('PRIVACY_POLICY_VERSION_CREATED', expect.objectContaining({ actorId: USER_ID, details: expect.objectContaining({ version: '1.1', s3Key: expectedKey }), entityId: 'p-new' })
      );
      expect(PrivacyPolicyCreatedResponseDTO).toHaveBeenCalled();
      expect(result).toEqual({ dto: 'created' });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PRIVACY_POLICY_UPDATE', userId: null })
      );
    });

    it('registra warn si falla la notificación global (best-effort)', async () => {
      repo.findByVersion.mockResolvedValue(null);
      repo.createVersion.mockResolvedValue({ privacyPolicyId: 'p-new', effectiveDate: new Date('2026-01-01') });
      notifier.notify.mockRejectedValue(new Error('notif down'));

      await service.createVersion(baseData(), USER_ID);
      await flush();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error enviando notificación'),
        expect.objectContaining({ error: 'notif down', version: '1.1' })
      );
    });
  });
});
