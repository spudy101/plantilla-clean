// tests/unit/modules/admin/core/services/approval-request.service.test.ts
//
// ApprovalRequestService — capa admin de doble aprobación. Es un delgado orquestador que delega en
// el core DualApprovalService y agrega la auditoría de los endpoints admin (list/getById/getPolicy).
// resolve() delega sin auditar (el core ya audita y valida rol + segregación). Aislamos el core y el
// logger para verificar SOLO la delegación y las llamadas a logAudit.

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));

jest.mock('./dual-approval.service', () => ({
  list: jest.fn(),
  getById: jest.fn(),
  getPolicy: jest.fn(),
  resolve: jest.fn()
}));

import { mocked, fixture } from 'tests/helpers/mock';
import auditServiceModule from '../../audit/infrastructure/legacy/audit-recorder';
const logAudit = mocked(auditServiceModule).record;
import DualApprovalServiceModule from './dual-approval.service';
const DualApprovalService = mocked(DualApprovalServiceModule);
import service from './approval-request.service';

const ADMIN = 'admin-1';
const PAGE = { page: 1, limit: 10, sortBy: 'createdAt' as const, order: 'DESC' as const };
const ENTITY = { entityType: 'ApprovalRequest', entityTable: 'approval_requests' };

describe('ApprovalRequestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('delega en el core y audita con operationKey/status normalizados', async () => {
      const coreResult = { data: [{ id: 'r1' }], metadata: {} };
      DualApprovalService.list.mockResolvedValue(coreResult);
      const query = { ...PAGE, operationKey: 'CLIENT_ACCOUNT_DELETE', status: 'pending' as const };

      const result = await service.list(query, ADMIN);

      expect(DualApprovalService.list).toHaveBeenCalledWith(query);
      expect(logAudit).toHaveBeenCalledWith('APPROVAL_REQUEST_LIST_VIEWED', { actorId: ADMIN, details: { operationKey: 'CLIENT_ACCOUNT_DELETE', status: 'pending' }, ...ENTITY }
      );
      expect(result).toBe(coreResult);
    });

    it('normaliza operationKey/status ausentes a null en la auditoría', async () => {
      DualApprovalService.list.mockResolvedValue({ data: [] });

      await service.list(PAGE, ADMIN);

      expect(logAudit).toHaveBeenCalledWith('APPROVAL_REQUEST_LIST_VIEWED', { actorId: ADMIN, details: { operationKey: null, status: null }, ...ENTITY }
      );
    });
  });

  describe('getById', () => {
    it('delega en el core y audita con entityId', async () => {
      const data = { id: 'req-9' };
      DualApprovalService.getById.mockResolvedValue(data);

      const result = await service.getById('req-9', ADMIN);

      expect(DualApprovalService.getById).toHaveBeenCalledWith('req-9');
      expect(logAudit).toHaveBeenCalledWith('APPROVAL_REQUEST_VIEWED', expect.objectContaining({ actorId: ADMIN, entityId: 'req-9', ...ENTITY }));
      expect(result).toBe(data);
    });
  });

  describe('getPolicy', () => {
    it('delega en el core y audita la consulta de política', async () => {
      const data = { operations: [] };
      DualApprovalService.getPolicy.mockResolvedValue(data);

      const result = await service.getPolicy(ADMIN);

      expect(DualApprovalService.getPolicy).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('APPROVAL_POLICY_VIEWED', expect.objectContaining({ actorId: ADMIN, ...ENTITY }));
      expect(result).toBe(data);
    });
  });

  describe('resolve', () => {
    it('delega en el core sin auditar (el core ya audita y valida segregación)', () => {
      const coreResult = Promise.resolve({ status: 'approved' });
      DualApprovalService.resolve.mockReturnValue(coreResult);
      const body = { decision: 'approve' };
      const ctx = { approverUserId: 'admin-2' };

      const result = service.resolve('req-1', body, fixture(ctx));

      expect(DualApprovalService.resolve).toHaveBeenCalledWith('req-1', body, ctx);
      expect(logAudit).not.toHaveBeenCalled();
      expect(result).toBe(coreResult);
    });
  });
});
