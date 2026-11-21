// provider-fallback: lo que hace el módulo integration cuando un circuito se abre o se cierra.

jest.mock('../repositories/provider-fallback-event.repository', () => ({ openFallback: jest.fn(), closeFallback: jest.fn() }));
jest.mock('../../audit', () => ({ audit: { record: jest.fn() } }));
jest.mock('../../notification', () => ({ smsDeliveryAttemptRepository: { countFailedBetween: jest.fn() } }));
jest.mock('../../../shared/observability/operation', () => ({ runOperation: (_opts: unknown, fn: () => unknown) => fn() }));
jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { mocked } from 'tests/helpers/mock';
import repoModule from '../repositories/provider-fallback-event.repository';
const repo = mocked(repoModule);
import auditModule from '../../audit';
const { audit } = mocked(auditModule);
import notificationModule from '../../notification';
const { smsDeliveryAttemptRepository } = mocked(notificationModule);
import providerFallback from './provider-fallback.service';

const OPENED_AT = Date.parse('2026-11-18T10:00:00Z');

describe('providerFallback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('onOpen abre la ventana con el nombre del proveedor y audita la activación', async () => {
    await providerFallback.onOpen('ses', OPENED_AT);
    expect(repo.openFallback).toHaveBeenCalledWith({
      provider: 'aws_ses',
      circuitProduct: 'ses',
      startedAt: new Date(OPENED_AT)
    });
    expect(audit.record).toHaveBeenCalledWith('PROVIDER_FALLBACK_ACTIVATED', expect.objectContaining({ actorId: null }));
  });

  it('onClose cierra la ventana con duración y cuenta los SMS afectados', async () => {
    smsDeliveryAttemptRepository.countFailedBetween.mockResolvedValue(4);
    await providerFallback.onClose('aws_sms', OPENED_AT);
    expect(repo.closeFallback).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'aws_sms', startedAt: new Date(OPENED_AT), affectedCount: 4 })
    );
    expect(audit.record).toHaveBeenCalledWith(
      'PROVIDER_FALLBACK_RESOLVED',
      expect.objectContaining({ details: expect.objectContaining({ affectedCount: 4, durationSeconds: expect.any(Number) }) })
    );
  });

  it('onClose de un producto sin tabla de intentos → affectedCount null', async () => {
    await providerFallback.onClose('s3', OPENED_AT);
    expect(smsDeliveryAttemptRepository.countFailedBetween).not.toHaveBeenCalled();
    expect(repo.closeFallback).toHaveBeenCalledWith(expect.objectContaining({ provider: 'aws_s3', affectedCount: null }));
  });

  it('nunca lanza: un error de BD se loguea', async () => {
    repo.openFallback.mockRejectedValue(new Error('BD caída'));
    await expect(providerFallback.onOpen('ses', OPENED_AT)).resolves.toBeUndefined();
  });
});
