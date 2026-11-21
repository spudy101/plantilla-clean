// tests/unit/modules/admin/core/services/system-global-config.service.test.ts
//
// SystemGlobalConfigService — lectura/actualización de la configuración global del sistema (única
// fila activa). Probamos: getConfig (feliz + 404 si no hay config activa); updateConfig con la config
// existente (arma el payload, incrementa version, audita, notifica) y la rama donde no existe config
// activa (la crea con defaults). El merge parcial de integration_resilience (camelCase→snake_case,
// con circuit_breaker anidado) se verifica capturando el payload de systemGlobalConfigRepository.update. Modelo Sequelize,
// DTO, request-context, notificaciones y logger se mockean. La notificación sale en setImmediate.

jest.mock('../../../shared/http/app-error.util', () => ({
  notFound: (msg: Loose) => Object.assign(new Error(msg), { statusCode: 404 })
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../../../shared/observability/request-context.util', () => ({
  originFromContext: jest.fn().mockReturnValue({ origin_session: 'sess-1' })
}));

// El service ya no toca el modelo de Sequelize: depende del repositorio (SOLID: D).
jest.mock('../repositories/system-global-config.repository', () => ({
  findActive: jest.fn(),
  createActive: jest.fn(),
  update: jest.fn()
}));

jest.mock('../responses/system-global-config.response', () => ({
  SystemGlobalConfigDTO: (record: Loose) => ({ dto: 'config', ...record })
}));

jest.mock('../../notification/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined)
}));

import { mocked, Loose, fixture } from 'tests/helpers/mock';
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import systemGlobalConfigRepositoryModule from '../repositories/system-global-config.repository';
const systemGlobalConfigRepository = mocked(systemGlobalConfigRepositoryModule);
import notificationCreationServiceModule from '../../notification/notify';
const notifier = mocked(notificationCreationServiceModule);
import service from './system-global-config.service';

const flush = () => new Promise(resolve => { setImmediate(resolve); });

// Fila de config activa (objeto plano: la escritura va por el repositorio, no por la instancia).
const makeConfig = (over = {}): Record<string, Loose> => ({
  systemGlobalConfigId: 'cfg-1',
  configVersion: 3,
  integrationResilience: { timeout_ms: 1000, circuit_breaker: { failure_threshold: 5, recovery_time_ms: 30000 } },
  ...over
});

/** Payload que el service le pasó a systemGlobalConfigRepository.update(configId, payload). */
const updatePayload = () => systemGlobalConfigRepository.update.mock.calls[0][1];

describe('SystemGlobalConfigService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // El repositorio devuelve la fila actualizada
    // Como la base: configVersion llega como { increment: 1 } y la fila devuelta ya trae la versión nueva
    systemGlobalConfigRepository.update.mockImplementation(async (configId: string, payload: Loose) => {
      const current = makeConfig();
      return { ...current, ...payload, systemGlobalConfigId: configId, configVersion: current.configVersion + payload.configVersion.increment };
    });
  });

  // ============================================================
  // getConfig
  // ============================================================

  describe('getConfig', () => {
    it('devuelve la config activa y audita la lectura', async () => {
      systemGlobalConfigRepository.findActive.mockResolvedValue(makeConfig());

      const result = await service.getConfig('admin-1');

      expect(systemGlobalConfigRepository.findActive).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('SYSTEM_GLOBAL_CONFIG_VIEWED', expect.objectContaining({ actorId: 'admin-1', entityId: 'cfg-1' }));
      expect(result).toMatchObject({ dto: 'config', systemGlobalConfigId: 'cfg-1' });
    });

    it('lanza (404) si no hay configuración global activa', async () => {
      systemGlobalConfigRepository.findActive.mockResolvedValue(null);
      await expect(service.getConfig('admin-1')).rejects.toThrow(/No hay una configuración global activa/);
    });
  });

  // ============================================================
  // updateConfig
  // ============================================================

  describe('updateConfig', () => {
    it('actualiza campos simples, incrementa la versión, audita, notifica y devuelve el DTO', async () => {
      const config = makeConfig();
      systemGlobalConfigRepository.findActive.mockResolvedValue(config);

      const data = { currency: 'USD', auditRetentionHotYears: 2, auditHotPurgeEnabled: true };
      const result = await service.updateConfig(data, 'admin-1', fixture({}));

      expect(systemGlobalConfigRepository.update).toHaveBeenCalledWith('cfg-1', expect.any(Object));
      const payload = updatePayload();
      expect(payload).toMatchObject({
        configVersion: { increment: 1 },
        currency: 'USD',
        auditRetentionHotYears: 2,
        auditHotPurgeEnabled: true
      });
      expect(logAudit).toHaveBeenCalledWith('SYSTEM_GLOBAL_CONFIG_UPDATED', expect.objectContaining({ actorId: 'admin-1', details: expect.objectContaining({ updatedFields: ['currency', 'auditRetentionHotYears', 'auditHotPurgeEnabled'], configVersion: { before: 3, after: 4 } }) })
      );
      expect(result).toMatchObject({ dto: 'config', configVersion: 4 });

      await flush();
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SYSTEM_CONFIG_UPDATED_INTERNAL', userId: null })
      );
    });

    it('hace merge parcial de integration_resilience (camelCase→snake_case, circuit_breaker anidado, conserva lo no enviado)', async () => {
      const config = makeConfig();
      systemGlobalConfigRepository.findActive.mockResolvedValue(config);

      const data = {
        integrationResilience: {
          maxRetries: 4,
          circuitBreaker: { failureThreshold: 9 }
        }
      };
      await service.updateConfig(data, 'admin-1', fixture({}));

      const resilience = updatePayload().integrationResilience;
      // nuevos valores mapeados a snake_case
      expect(resilience.max_retries).toBe(4);
      expect(resilience.circuit_breaker.failure_threshold).toBe(9);
      // conserva lo previo no enviado
      expect(resilience.timeout_ms).toBe(1000);
      expect(resilience.circuit_breaker.recovery_time_ms).toBe(30000);
    });

    it('si no existe config activa la crea con defaults (el origen de sesión lo pone la extensión de Prisma)', async () => {
      systemGlobalConfigRepository.findActive.mockResolvedValue(null);
      systemGlobalConfigRepository.createActive.mockResolvedValue(makeConfig({ configVersion: 0 }));

      const result = await service.updateConfig({ currency: 'CLP' }, 'admin-1', fixture({}));

      expect(systemGlobalConfigRepository.createActive).toHaveBeenCalledWith();
      expect(result).toMatchObject({ dto: 'config' });
    });
  });
});
