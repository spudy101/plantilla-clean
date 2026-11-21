// tests/unit/modules/client/records/legal/services/user-consent.service.test.ts
//
// UserConsentService — catálogo/otorgamiento/revocación de consentimientos del cliente. Probamos
// getMyConsents (merge del catálogo con lo otorgado), grant (validación de items, resolución por
// código, commit + audit por entrada, rollback ante error) y revokeMarketing (guardas de existencia
// y revocabilidad, rollback si no hay activo). Mockeamos repos, DTOs, el cliente de Prisma y logger; AppError real.

jest.mock('../repositories/consent-type.repository', () => ({
  findAllActive: jest.fn(),
  findByCode: jest.fn(),
  findById: jest.fn()
}));

jest.mock('../repositories/user-consent.repository', () => ({
  findCurrentByUser: jest.fn(),
  grant: jest.fn(),
  revoke: jest.fn()
}));

jest.mock('../responses/user-consent.response', () => ({
  MyConsentCatalogDTO: jest.fn((type, record) => ({ code: type.code, granted: !!record })),
  ConsentGrantedDTO: jest.fn(r => ({ id: r.userConsentId }))
}));

jest.mock('../../../shared/database/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));

jest.mock('../../../shared/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

import { managedTransaction } from 'tests/helpers/transaction';
import { mocked } from 'tests/helpers/mock';
import consentTypeRepositoryModule from '../repositories/consent-type.repository';
const consentTypeRepository = mocked(consentTypeRepositoryModule);
import userConsentRepositoryModule from '../repositories/user-consent.repository';
const userConsentRepository = mocked(userConsentRepositoryModule);
import prismaModule from '../../../shared/database/prisma';
const prisma = mocked(prismaModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './user-consent.service';

const USER_ID = 'user-1';
const AUDIT_CTX = { ip: '1.2.3.4', userAgent: 'jest', reason: 'ya no quiero' };

function mockTx() {
  const tx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
  prisma.$transaction.mockImplementation(managedTransaction(tx));
  return tx;
}

describe('UserConsentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMyConsents', () => {
    it('cruza el catálogo activo con los consentimientos vigentes y audita', async () => {
      consentTypeRepository.findAllActive.mockResolvedValue([{ consentTypeId: 'a', code: 'PP' }, { consentTypeId: 'b', code: 'CC' }]);
      userConsentRepository.findCurrentByUser.mockResolvedValue([{ consentTypeId: 'a' }]);

      const result = await service.getMyConsents(USER_ID);

      expect(result).toEqual([
        { code: 'PP', granted: true },
        { code: 'CC', granted: false }
      ]);
      expect(logAudit).toHaveBeenCalledWith('CONSENT_CATALOG_VIEWED', expect.objectContaining({ actorId: USER_ID, details: expect.objectContaining({ totalItems: 2, grantedCount: 1 }) })
      );
    });
  });

  describe('grant', () => {
    it('lanza badRequest si no se envían items', async () => {
      await expect(service.grant([], USER_ID, AUDIT_CTX)).rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza badRequest y hace rollback si el código de consentimiento no existe', async () => {
      const tx = mockTx();
      consentTypeRepository.findByCode.mockResolvedValue(null);

      await expect(service.grant([{ consentTypeCode: 'FAKE' }], USER_ID, AUDIT_CTX)).rejects.toMatchObject({
        statusCode: 400
      });
      expect(tx.rollback).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
    });

    it('otorga cada item, commitea, audita por entrada y devuelve los DTO', async () => {
      const tx = mockTx();
      consentTypeRepository.findByCode
        .mockResolvedValueOnce({ consentTypeId: 'a' })
        .mockResolvedValueOnce({ consentTypeId: 'b' });
      userConsentRepository.grant
        .mockResolvedValueOnce({ userConsentId: 'uc-1' })
        .mockResolvedValueOnce({ userConsentId: 'uc-2' });

      const items = [
        { consentTypeCode: 'PP', privacyPolicyId: 'pp-1' },
        { consentTypeCode: 'CC' }
      ];
      const result = await service.grant(items, USER_ID, AUDIT_CTX);

      expect(userConsentRepository.grant).toHaveBeenCalledTimes(2);
      expect(userConsentRepository.grant).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, consentTypeId: 'a', privacyPolicyId: 'pp-1', ip: '1.2.3.4' })
      );
      expect(tx.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenCalledWith('CONSENT_GRANTED', expect.objectContaining({ actorId: USER_ID }));
      expect(result).toEqual([{ id: 'uc-1' }, { id: 'uc-2' }]);
    });

    it('hace rollback y propaga si el otorgamiento en repo falla', async () => {
      const tx = mockTx();
      consentTypeRepository.findByCode.mockResolvedValue({ consentTypeId: 'a' });
      userConsentRepository.grant.mockRejectedValue(new Error('db down'));

      await expect(service.grant([{ consentTypeCode: 'PP' }], USER_ID, AUDIT_CTX)).rejects.toThrow('db down');
      expect(tx.rollback).toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe('revokeMarketing', () => {
    it('lanza notFound si el tipo de consentimiento no existe', async () => {
      consentTypeRepository.findById.mockResolvedValue(null);
      await expect(service.revokeMarketing(USER_ID, 'ct-1', AUDIT_CTX)).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza badRequest si el consentimiento no es revocable', async () => {
      consentTypeRepository.findById.mockResolvedValue({ isRevocable: false });
      await expect(service.revokeMarketing(USER_ID, 'ct-1', AUDIT_CTX)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('hace rollback y lanza notFound si no hay consentimiento activo para revocar', async () => {
      const tx = mockTx();
      consentTypeRepository.findById.mockResolvedValue({ isRevocable: true });
      userConsentRepository.revoke.mockResolvedValue(null);

      await expect(service.revokeMarketing(USER_ID, 'ct-1', AUDIT_CTX)).rejects.toMatchObject({ statusCode: 404 });
      expect(tx.rollback).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
    });

    it('revoca, commitea, audita y devuelve mensaje de éxito', async () => {
      const tx = mockTx();
      consentTypeRepository.findById.mockResolvedValue({ isRevocable: true });
      userConsentRepository.revoke.mockResolvedValue({ userConsentId: 'uc-9' });

      const result = await service.revokeMarketing(USER_ID, 'ct-1', AUDIT_CTX);

      expect(userConsentRepository.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, consentTypeId: 'ct-1', ip: '1.2.3.4', reason: 'ya no quiero' })
      );
      expect(tx.commit).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('CONSENT_REVOKED', expect.objectContaining({ actorId: USER_ID }));
      expect(result).toEqual({ message: 'Consentimiento revocado exitosamente' });
    });
  });
});
