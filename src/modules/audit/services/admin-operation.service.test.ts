// AdminOperationService — listado de operaciones y línea de tiempo (operación + hijas + auditoría +
// llamadas externas unidas por correlationId). Repositorios inyectados como dobles.
jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock('../audit.service', () => ({ record: jest.fn() }));

import adminOperationServiceModule from './admin-operation.service';
const { AdminOperationService } = adminOperationServiceModule;
import AppError from '../../../shared/presentation/http/app-error.util';
import { OperationListQuery } from '../requests/audit.request';

const OP_ID = '11111111-1111-4111-8111-111111111111';
const operation = {
  operationId: OP_ID,
  parentId: null,
  clientRequestId: null,
  source: 'http',
  name: 'GET /admin/api/v1/x',
  status: 'success',
  httpStatus: 200,
  errorCode: null,
  errorMessage: null,
  userId: null,
  sessionId: null,
  ip: '127.0.0.1',
  startedAt: new Date('2026-11-18T10:00:00Z'),
  endedAt: new Date('2026-11-18T10:00:01Z'),
  durationMs: 1000
};

function build() {
  const deps = {
    operationRepository: {
      findAllPaginated: jest.fn().mockResolvedValue({ rows: [operation], count: 1 }),
      findById: jest.fn().mockResolvedValue(operation),
      findChildren: jest.fn().mockResolvedValue([])
    },
    auditLogRepository: {
      findByCorrelationId: jest.fn().mockResolvedValue([
        { auditLogId: 'a1', action: 'PERSON_ROLE_CHANGED', description: 'x', outcome: 'success', risk: 'high', userId: null, entityType: 'User', entityId: 'u1', createdAt: new Date() }
      ])
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { deps, service: new AdminOperationService(deps as any) };
}

describe('AdminOperationService', () => {
  it('list: traduce los filtros de la query y devuelve data + metadata', async () => {
    const { deps, service } = build();
    const result = await service.list(OperationListQuery.parse({ source: 'worker', status: 'failure', page: '2', limit: '5', sortBy: 'durationMs' }), 'admin-1');

    expect(deps.operationRepository.findAllPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'worker', status: 'failure' }),
      { page: 2, limit: 5, offset: 5, sortBy: 'durationMs', order: 'DESC' }
    );
    expect(result.data).toHaveLength(1);
    expect(result.metadata).toMatchObject({
      pagination: { currentPage: 2, totalItems: 1 },
      sort: { field: 'durationMs', order: 'DESC' },
      filters: { source: 'worker', status: 'failure' }
    });
  });

  it('timeline: une la operación con su auditoría por correlationId y trae la consulta de CloudWatch', async () => {
    const { deps, service } = build();
    const result = await service.timeline(OP_ID, 'admin-1');

    expect(deps.auditLogRepository.findByCorrelationId).toHaveBeenCalledWith(OP_ID);
    expect(result.operation.operationId).toBe(OP_ID);
    expect(result.auditEvents[0]).toMatchObject({ action: 'PERSON_ROLE_CHANGED' });
    expect(result.logsQuery).toContain(OP_ID);
  });

  it('timeline: 404 si la operación no existe', async () => {
    const { deps, service } = build();
    deps.operationRepository.findById.mockResolvedValue(null);
    await expect(service.timeline(OP_ID, 'admin-1')).rejects.toBeInstanceOf(AppError);
  });
});
