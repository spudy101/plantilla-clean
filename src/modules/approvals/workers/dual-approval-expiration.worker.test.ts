// tests/unit/modules/schemas/core/workers/dual-approval-expiration.worker.test.ts
//
// Worker de vencimiento de solicitudes de doble aprobación. Marca vencidas las pendientes cuyo plazo
// pasó y audita cada una. Si una se resolvió entre la consulta y el update (markExpired → false), no se
// pisa ni se audita como vencida.

jest.mock('../repositories/approval-request.repository', () => ({
  findExpired: jest.fn(),
  markExpired: jest.fn()
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/infrastructure/legacy/audit-recorder', () => ({ record: jest.fn() }));

import { mocked } from 'tests/helpers/mock';
import approvalRepoModule from '../repositories/approval-request.repository';
const approvalRepo = mocked(approvalRepoModule);
import auditServiceModule from '../../audit/infrastructure/legacy/audit-recorder';
const logAudit = mocked(auditServiceModule).record;
import DualApprovalExpirationWorker from './dual-approval-expiration.worker';

const request = (id: string) => ({ approvalRequestId: id, operationKey: 'OP', entityType: 'User', entityId: 'u-1', expiresAt: new Date() });

describe('DualApprovalExpirationWorker._processExpired', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marca y audita las vencidas; saltea las que ya no estaban pendientes', async () => {
    approvalRepo.findExpired.mockResolvedValue([request('r-1'), request('r-2')]);
    approvalRepo.markExpired.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await DualApprovalExpirationWorker._processExpired();

    expect(approvalRepo.markExpired).toHaveBeenCalledWith('r-1', expect.any(Date));
    expect(approvalRepo.markExpired).toHaveBeenCalledWith('r-2', expect.any(Date));
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith('DUAL_APPROVAL_EXPIRED', expect.objectContaining({ actorId: 'system', details: expect.objectContaining({ approvalRequestId: 'r-1' }) }));
  });
});
