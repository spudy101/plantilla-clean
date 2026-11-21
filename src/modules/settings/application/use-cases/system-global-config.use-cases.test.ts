// Casos de uso de settings con dobles en memoria de sus puertos: sin jest.mock, sin Prisma, sin Express.
import { GetSystemGlobalConfig } from './get-system-global-config.use-case';
import { UpdateSystemGlobalConfig, SYSTEM_CONFIG_UPDATED_NOTIFICATION } from './update-system-global-config.use-case';
import { GetIntegrationResilience } from './get-integration-resilience.use-case';
import { ActiveConfigNotFoundError, ConfigNotFoundError } from '../../domain/errors';
import {
  InMemorySystemGlobalConfigRepository,
  RecordingAuditTrail,
  RecordingNotifier,
  silentLogger
} from '../../../../../tests/doubles/settings.doubles';

const flush = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

describe('GetSystemGlobalConfig', () => {
  it('devuelve la configuración activa y audita la consulta', async () => {
    const audit = new RecordingAuditTrail();
    const result = await new GetSystemGlobalConfig(new InMemorySystemGlobalConfigRepository(), audit).execute({
      actorId: 'admin-1'
    });

    expect(result).toEqual({
      configId: 'cfg-1',
      configVersion: 3,
      currency: 'CLP',
      auditRetentionHotYears: 5,
      auditRetentionColdYears: 10,
      auditHotPurgeEnabled: false,
      integrationResilience: {
        timeoutMs: 1000,
        maxRetries: null,
        circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000, failuresTtlS: null }
      }
    });
    expect(audit.entries).toEqual([
      expect.objectContaining({ action: 'SYSTEM_GLOBAL_CONFIG_VIEWED', actorId: 'admin-1', entityId: 'cfg-1' })
    ]);
  });

  it('sin configuración activa lanza ActiveConfigNotFoundError (y no audita)', async () => {
    const audit = new RecordingAuditTrail();
    const useCase = new GetSystemGlobalConfig(new InMemorySystemGlobalConfigRepository(null), audit);

    await expect(useCase.execute({ actorId: 'admin-1' })).rejects.toBeInstanceOf(ActiveConfigNotFoundError);
    expect(audit.entries).toEqual([]);
  });
});

describe('UpdateSystemGlobalConfig', () => {
  const setup = (repo = new InMemorySystemGlobalConfigRepository()) => {
    const audit = new RecordingAuditTrail();
    const notifier = new RecordingNotifier();
    return { repo, audit, notifier, useCase: new UpdateSystemGlobalConfig(repo, audit, notifier, silentLogger) };
  };

  it('guarda los campos enviados, sube la versión, audita y notifica a los administradores', async () => {
    const { useCase, audit, notifier } = setup();

    const result = await useCase.execute({
      actorId: 'admin-1',
      patch: { currency: 'USD', auditRetentionHotYears: 2, auditHotPurgeEnabled: true }
    });

    expect(result).toMatchObject({ configVersion: 4, currency: 'USD', auditRetentionHotYears: 2, auditHotPurgeEnabled: true });
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'SYSTEM_GLOBAL_CONFIG_UPDATED',
        actorId: 'admin-1',
        details: {
          updatedFields: ['currency', 'auditRetentionHotYears', 'auditHotPurgeEnabled'],
          configVersion: { before: 3, after: 4 }
        }
      })
    ]);
    await flush();
    expect(notifier.sent).toEqual([expect.objectContaining({ type: SYSTEM_CONFIG_UPDATED_NOTIFICATION, userId: null })]);
  });

  it('fusiona la resiliencia con la guardada (lo no enviado se conserva)', async () => {
    const { useCase, repo } = setup();

    const result = await useCase.execute({
      actorId: 'admin-1',
      patch: { integrationResilience: { maxRetries: 4, circuitBreaker: { failureThreshold: 9 } } }
    });

    expect(repo.appliedChanges[0]?.integrationResilience?.toProps()).toEqual({
      timeoutMs: 1000,
      maxRetries: 4,
      circuitBreaker: { failureThreshold: 9, recoveryTimeMs: 30000 }
    });
    expect(result.integrationResilience).toEqual({
      timeoutMs: 1000,
      maxRetries: 4,
      circuitBreaker: { failureThreshold: 9, recoveryTimeMs: 30000, failuresTtlS: null }
    });
  });

  it('si no hay configuración activa la crea con los defaults y la actualiza', async () => {
    const { useCase } = setup(new InMemorySystemGlobalConfigRepository(null));

    const result = await useCase.execute({ actorId: 'admin-1', patch: { currency: 'COP' } });

    expect(result).toMatchObject({ configId: 'cfg-new', configVersion: 2, currency: 'COP' });
  });

  it('si la configuración desaparece al guardar lanza ConfigNotFoundError', async () => {
    const repo = new InMemorySystemGlobalConfigRepository();
    repo.vanishOnWrite();
    const { useCase } = setup(repo);

    await expect(useCase.execute({ actorId: 'admin-1', patch: { currency: 'USD' } })).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it('un fallo al notificar no rompe la actualización', async () => {
    const { useCase, notifier } = setup();
    notifier.failWith = new Error('SES caído');

    await expect(useCase.execute({ actorId: 'admin-1', patch: { currency: 'USD' } })).resolves.toMatchObject({ currency: 'USD' });
    await flush();
  });
});

describe('GetIntegrationResilience', () => {
  it('devuelve lo configurado, o null sin configuración activa', async () => {
    expect(await new GetIntegrationResilience(new InMemorySystemGlobalConfigRepository()).execute()).toEqual({
      timeoutMs: 1000,
      circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 }
    });
    expect(await new GetIntegrationResilience(new InMemorySystemGlobalConfigRepository(null)).execute()).toBeNull();
  });
});
