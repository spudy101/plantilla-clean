// AuditService.record — clasificación desde el catálogo, contexto de la operación, regla transaccional
// (éxito dentro de la transacción, intentos fallidos aparte), alertas y manejo de errores.
jest.mock('../../shared/observability/logger.util', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock('../../shared/database/transaction-context', () => ({ activeUnit: jest.fn(() => null) }));
jest.mock('./repositories/audit-log.repository', () => ({ create: jest.fn() }));
jest.mock('./repositories/audit-alert.repository', () => ({ create: jest.fn() }));

import auditServiceModule from './audit.service';
const { AuditService } = auditServiceModule;
import requestContext from '../../shared/observability/request-context.util';
import txContextModule from '../../shared/database/transaction-context';
import loggerUtilModule from '../../shared/observability/logger.util';
import { mocked } from 'tests/helpers/mock';

const txContext = mocked(txContextModule);
const { logger } = mocked(loggerUtilModule);
const USER = '22222222-2222-4222-8222-222222222222';

function build() {
  const auditLogRepository = { create: jest.fn().mockResolvedValue({ auditLogId: 'log-1', userId: USER, entityId: 'e1', entityType: 'User' }) };
  const auditAlertRepository = { create: jest.fn().mockResolvedValue({}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { auditLogRepository, auditAlertRepository, audit: new AuditService({ auditLogRepository, auditAlertRepository } as any) };
}

const ctx = {
  correlationId: 'op-1',
  source: 'http' as const,
  name: 'PUT /x',
  ip: '10.0.0.1',
  userAgent: 'jest',
  fingerprintHash: 'fp',
  method: 'PUT',
  path: '/x',
  sessionId: '33333333-3333-4333-8333-333333333333'
};

describe('AuditService.record', () => {
  beforeEach(() => txContext.activeUnit.mockReturnValue(null));

  it('clasifica con el catálogo y toma quién/desde dónde del contexto de la operación', async () => {
    const { audit, auditLogRepository } = build();
    await requestContext.run(ctx, () => audit.record('SYSTEM_GLOBAL_CONFIG_VIEWED', { actorId: USER, entityId: 'c1' }));

    expect(auditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SYSTEM_GLOBAL_CONFIG_VIEWED',
        category: 'Configuración',
        risk: 'low',
        outcome: 'success',
        userId: USER,
        correlationId: 'op-1',
        sessionId: ctx.sessionId,
        ip: '10.0.0.1',
        entityId: 'c1'
      }),
      { independent: false }
    );
  });

  it('los intentos fallidos se escriben aparte de la transacción', async () => {
    const { audit, auditLogRepository } = build();
    await audit.record('AUTH_FAILURE', { actorId: null, outcome: 'failure' });
    expect(auditLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }), { independent: true });
  });

  it('una acción con alert crea la alerta enlazada al registro', async () => {
    const { audit, auditAlertRepository } = build();
    await audit.record('SYSTEM_GLOBAL_CONFIG_UPDATED', { actorId: USER });
    expect(auditAlertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ auditLogId: 'log-1', action: 'SYSTEM_GLOBAL_CONFIG_UPDATED', risk: 'high' }),
      { independent: false }
    );
  });

  it('una acción sin alert no crea alerta', async () => {
    const { audit, auditAlertRepository } = build();
    await audit.record('SYSTEM_GLOBAL_CONFIG_VIEWED', { actorId: USER });
    expect(auditAlertRepository.create).not.toHaveBeenCalled();
  });

  it("un actor no-UUID ('system') no va a la FK de usuarios", async () => {
    const { audit, auditLogRepository } = build();
    await audit.record('WORKER_CYCLE_FAILED', { actorId: 'system', outcome: 'failure' });
    expect(auditLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({ userId: null }), { independent: true });
  });

  it('dentro de una transacción, si la escritura falla, relanza (el cambio se revierte con ella)', async () => {
    txContext.activeUnit.mockReturnValue({ prisma: jest.fn() });
    const { audit, auditLogRepository } = build();
    auditLogRepository.create.mockRejectedValue(new Error('db caída'));
    await expect(audit.record('SYSTEM_GLOBAL_CONFIG_VIEWED', { actorId: USER })).rejects.toThrow('db caída');
  });

  it('fuera de una transacción, si la escritura falla, lo reporta y no rompe el flujo', async () => {
    const { audit, auditLogRepository } = build();
    auditLogRepository.create.mockRejectedValue(new Error('db caída'));
    await expect(audit.record('SYSTEM_GLOBAL_CONFIG_VIEWED', { actorId: USER })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('No se pudo registrar la auditoría', expect.objectContaining({ action: 'SYSTEM_GLOBAL_CONFIG_VIEWED' }));
  });
});
