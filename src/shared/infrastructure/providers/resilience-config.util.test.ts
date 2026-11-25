// ResilienceConfig: resuelve la config de resiliencia de integraciones desde
// SystemGlobalConfig.integration_resilience (snake_case), la mapea a camelCase,
// la cachea 60s y NUNCA lanza (fallback duro / último valor ante error de BD).
// La fuente (en la app, el módulo settings) se registra con un doble; el logger va mockeado.

const mockFindOne = jest.fn();

jest.mock('../observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { mocked } from 'tests/helpers/mock';
import loggerUtilModule from '../observability/logger.util';
const { logger } = mocked(loggerUtilModule);
import ResilienceConfig from './resilience-config.util';
import type { ConfiguredResilience } from './resilience-config.util';

describe('ResilienceConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Misma forma que conecta src/main/: lo configurado (camelCase) o null
    ResilienceConfig.registerResilienceSource(async () => ((await mockFindOne()) as { integrationResilience?: ConfiguredResilience } | null)?.integrationResilience);
    ResilienceConfig._resetCache();
  });

  describe('HARD_DEFAULTS', () => {
    it('expone los defaults duros históricos (30s / 3 intentos + umbrales del breaker)', () => {
      expect(ResilienceConfig.HARD_DEFAULTS).toMatchObject({
        timeoutMs: 30000,
        maxRetries: 3,
        circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 }
      });
    });

    it('está congelado (Object.freeze) para no mutarse por accidente', () => {
      expect(Object.isFrozen(ResilienceConfig.HARD_DEFAULTS)).toBe(true);
      expect(Object.isFrozen(ResilienceConfig.HARD_DEFAULTS.circuitBreaker)).toBe(true);
    });
  });

  describe('get() — mapeo snake_case → camelCase', () => {
    it('mapea todos los campos cuando la global trae la config completa', async () => {
      mockFindOne.mockResolvedValue({
        integrationResilience: {
          timeoutMs: 12000,
          maxRetries: 7,
          circuitBreaker: { failureThreshold: 9, recoveryTimeMs: 15000, failuresTtlS: 111 }
        }
      });

      const cfg = await ResilienceConfig.get();

      expect(cfg).toEqual({
        timeoutMs: 12000,
        maxRetries: 7,
        circuitBreaker: { failureThreshold: 9, recoveryTimeMs: 15000, failuresTtlS: 111 }
      });
    });

    it('rellena con los defaults duros los campos ausentes (config parcial)', async () => {
      mockFindOne.mockResolvedValue({
        integrationResilience: {
          timeoutMs: 8000,
          circuitBreaker: { failureThreshold: 2 }
        }
      });

      const cfg = await ResilienceConfig.get();

      expect(cfg.timeoutMs).toBe(8000);
      expect(cfg.maxRetries).toBe(3); // default duro
      expect(cfg.circuitBreaker).toEqual({
        failureThreshold: 2, // override
        recoveryTimeMs: 60000, // default duro
        failuresTtlS: 300 // default duro
      });
    });

    it('usa todos los defaults duros si integration_resilience viene vacío', async () => {
      mockFindOne.mockResolvedValue({ integrationResilience: {} });
      const cfg = await ResilienceConfig.get();
      expect(cfg.timeoutMs).toBe(30000);
      expect(cfg.circuitBreaker).toEqual({ failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 });
    });

    it('usa defaults si no existe fila activa (findOne devuelve null)', async () => {
      mockFindOne.mockResolvedValue(null);
      const cfg = await ResilienceConfig.get();
      expect(cfg.timeoutMs).toBe(30000);
      expect(cfg.maxRetries).toBe(3);
    });
  });

  describe('caché (TTL 60s)', () => {
    it('no vuelve a consultar la BD dentro de la ventana de caché', async () => {
      mockFindOne.mockResolvedValue({ integrationResilience: { timeoutMs: 1234 } });

      const a = await ResilienceConfig.get();
      const b = await ResilienceConfig.get();

      expect(mockFindOne).toHaveBeenCalledTimes(1);
      expect(a).toBe(b); // misma referencia cacheada
      expect(a.timeoutMs).toBe(1234);
    });

    it('_resetCache fuerza una nueva lectura', async () => {
      mockFindOne.mockResolvedValue({ integrationResilience: { timeoutMs: 1 } });
      await ResilienceConfig.get();
      ResilienceConfig._resetCache();
      await ResilienceConfig.get();
      expect(mockFindOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('resiliencia ante errores (nunca lanza)', () => {
    it('devuelve el fallback duro si la BD lanza y no hay caché previa', async () => {
      mockFindOne.mockRejectedValue(new Error('BD caída'));

      const cfg = await ResilienceConfig.get();

      expect(cfg).toMatchObject(ResilienceConfig.HARD_DEFAULTS);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[ResilienceConfig]'),
        expect.objectContaining({ error: 'BD caída' })
      );
    });

    it('el fallback devuelto es una copia mutable (no el objeto congelado)', async () => {
      mockFindOne.mockRejectedValue(new Error('boom'));
      const cfg = await ResilienceConfig.get();
      expect(Object.isFrozen(cfg)).toBe(false);
      expect(Object.isFrozen(cfg.circuitBreaker)).toBe(false);
    });

    it('conserva el último valor cacheado si, tras expirar la caché, la lectura falla', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      try {
        // t=0: primera lectura buena → cachea timeout 4321.
        nowSpy.mockReturnValue(0);
        mockFindOne.mockResolvedValueOnce({ integrationResilience: { timeoutMs: 4321 } });
        const first = await ResilienceConfig.get();
        expect(first.timeoutMs).toBe(4321);

        // t=61s: caché expirada → intenta releer y la BD falla.
        nowSpy.mockReturnValue(61000);
        mockFindOne.mockRejectedValueOnce(new Error('BD caída'));
        const stale = await ResilienceConfig.get();

        // Debe devolver el último valor bueno cacheado, no el fallback duro.
        expect(stale.timeoutMs).toBe(4321);
        expect(logger.warn).toHaveBeenCalled();
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});
