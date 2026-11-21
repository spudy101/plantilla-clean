// Worker de archivado: exportación diaria de la auditoría a S3 (un JSONL por día) y retención técnica
// (operaciones y claves de idempotencia vencidas).
jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock('../repositories/audit-log.repository', () => ({ findCreatedBetween: jest.fn() }));
jest.mock('../../../shared/infrastructure/observability/operation.repository', () => ({ purgeOlderThan: jest.fn() }));
jest.mock('../../../shared/infrastructure/database/idempotency.repository', () => ({ purgeExpired: jest.fn() }));
jest.mock('../../../shared/infrastructure/storage/s3.util', () => ({ uploadArchive: jest.fn() }));
jest.mock('../../settings/infrastructure/persistence/legacy-system-global-config.repository', () => ({ findActive: jest.fn() }));
jest.mock('../audit.service', () => ({ record: jest.fn() }));

import worker from './audit-archive.worker';
import auditLogRepositoryModule from '../repositories/audit-log.repository';
import operationRepositoryModule from '../../../shared/infrastructure/observability/operation.repository';
import S3UtilModule from '../../../shared/infrastructure/storage/s3.util';
import idempotencyRepositoryModule from '../../../shared/infrastructure/database/idempotency.repository';
import { mocked } from 'tests/helpers/mock';

const auditLogRepository = mocked(auditLogRepositoryModule);
const operationRepository = mocked(operationRepositoryModule);
const S3Util = mocked(S3UtilModule);
const idempotencyRepository = mocked(idempotencyRepositoryModule);

describe('audit-archive.worker', () => {
  it('exportDay: sube el día completo (UTC) como JSONL a audit-logs/AAAA/MM/DD.jsonl', async () => {
    auditLogRepository.findCreatedBetween.mockResolvedValue([{ auditLogId: 'a' }, { auditLogId: 'b' }]);

    const count = await worker.exportDay(new Date('2026-11-17T15:30:00Z'));

    expect(count).toBe(2);
    expect(auditLogRepository.findCreatedBetween).toHaveBeenCalledWith(new Date('2026-11-17T00:00:00Z'), new Date('2026-11-18T00:00:00Z'));
    expect(S3Util.uploadArchive).toHaveBeenCalledWith('audit-logs/2026/11/17.jsonl', '{"auditLogId":"a"}\n{"auditLogId":"b"}\n');
  });

  it('exportDay: sin registros no sube nada', async () => {
    S3Util.uploadArchive.mockClear();
    auditLogRepository.findCreatedBetween.mockResolvedValue([]);
    await expect(worker.exportDay(new Date('2026-11-17T00:00:00Z'))).resolves.toBe(0);
    expect(S3Util.uploadArchive).not.toHaveBeenCalled();
  });

  it('purgeOperations: borra las operaciones más viejas que la retención configurada', async () => {
    operationRepository.purgeOlderThan.mockResolvedValue(5);
    const before = Date.now();
    await expect(worker.purgeOperations()).resolves.toBe(5);
    const cutoff = (operationRepository.purgeOlderThan.mock.calls[0] as [Date])[0];
    const days = (before - cutoff.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });

  it('retención técnica: purga operaciones y claves vencidas; si una falla, la otra corre igual', async () => {
    operationRepository.purgeOlderThan.mockRejectedValueOnce(new Error('BD'));
    idempotencyRepository.purgeExpired.mockResolvedValue(3);

    await expect(worker.purgeTechnicalData()).rejects.toThrow('BD');
    expect(idempotencyRepository.purgeExpired).toHaveBeenCalled();
  });
});
