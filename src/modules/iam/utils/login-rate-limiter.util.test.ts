// tests/unit/shared/login-rate-limiter.util.test.ts
//
// LoginRateLimiterUtil: dos capas de rate limiting (IP y cuenta) en Redis, con política fail-open.
// Mockeamos Redis, el logger y las constantes (umbrales pequeños y deterministas — en local los
// umbrales reales son gigantes vía IS_LOCALHOST).

const mockClient = {
  ttl: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
};

jest.mock('../../../shared/infra/redis.util', () => ({
  isAvailable: jest.fn(),
  getClient: jest.fn()
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));

jest.mock('../../../shared/constants', () => ({
  LOGIN_RATE_LIMIT: {
    IP_MAX_ATTEMPTS: 3,
    IP_WINDOW_SECS: 60,
    IP_BLOCK_SECS: 600,
    ACCOUNT_MAX_ATTEMPTS: 3,
    ACCOUNT_WINDOW_SECS: 1800,
    ACCOUNT_BLOCK_SECS: 1800
  }
}));

import { mocked } from 'tests/helpers/mock';
import redisClientModule from '../../../shared/infra/redis.util';
const redisClient = mocked(redisClientModule);
import LoginRateLimiter from './login-rate-limiter.util';

describe('LoginRateLimiterUtil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.isAvailable.mockReturnValue(true);
    redisClient.getClient.mockReturnValue(mockClient);
  });

  describe('fail-open (Redis no disponible)', () => {
    beforeEach(() => redisClient.isAvailable.mockReturnValue(false));

    it('checkIpBlock retorna null', async () => {
      await expect(LoginRateLimiter.checkIpBlock('1.2.3.4')).resolves.toBeNull();
    });

    it('incrementIpAttempts retorna null y no toca Redis', async () => {
      await expect(LoginRateLimiter.incrementIpAttempts('1.2.3.4')).resolves.toBeNull();
      expect(mockClient.incr).not.toHaveBeenCalled();
    });

    it('incrementAccountFailures retorna null', async () => {
      await expect(LoginRateLimiter.incrementAccountFailures('12345')).resolves.toBeNull();
    });
  });

  describe('capa IP', () => {
    it('checkIpBlock devuelve los segundos restantes si está bloqueada', async () => {
      mockClient.ttl.mockResolvedValue(120);
      await expect(LoginRateLimiter.checkIpBlock('1.2.3.4')).resolves.toBe(120);
    });

    it('checkIpBlock devuelve null si no hay bloqueo (ttl<=0)', async () => {
      mockClient.ttl.mockResolvedValue(-2);
      await expect(LoginRateLimiter.checkIpBlock('1.2.3.4')).resolves.toBeNull();
    });

    it('incrementIpAttempts fija TTL de ventana en el primer intento', async () => {
      mockClient.incr.mockResolvedValue(1);
      await LoginRateLimiter.incrementIpAttempts('1.2.3.4');
      expect(mockClient.expire).toHaveBeenCalledWith('login:ip:attempts:1.2.3.4', 60);
    });

    it('incrementIpAttempts no bloquea bajo el umbral', async () => {
      mockClient.incr.mockResolvedValue(2);
      await expect(LoginRateLimiter.incrementIpAttempts('1.2.3.4')).resolves.toBeNull();
      expect(mockClient.set).not.toHaveBeenCalled();
    });

    it('incrementIpAttempts bloquea al superar el umbral', async () => {
      mockClient.incr.mockResolvedValue(4); // > IP_MAX_ATTEMPTS (3)
      await expect(LoginRateLimiter.incrementIpAttempts('1.2.3.4')).resolves.toBe(600);
      expect(mockClient.set).toHaveBeenCalledWith('login:ip:blocked:1.2.3.4', '1', 'EX', 600, 'NX');
    });
  });

  describe('capa cuenta', () => {
    // El nationalId nunca se usa en claro: la key lleva su SHA-256.
    it('checkAccountBlock hashea el nationalId en la key', async () => {
      mockClient.ttl.mockResolvedValue(300);
      await expect(LoginRateLimiter.checkAccountBlock('12345678')).resolves.toBe(300);
      const keyUsed = mockClient.ttl.mock.calls[0][0];
      expect(keyUsed).toMatch(/^login:account:blocked:[a-f0-9]{64}$/);
      expect(keyUsed).not.toContain('12345678');
    });

    it('incrementAccountFailures bloquea al alcanzar el umbral', async () => {
      mockClient.incr.mockResolvedValue(3); // >= ACCOUNT_MAX_ATTEMPTS (3)
      await expect(LoginRateLimiter.incrementAccountFailures('12345678')).resolves.toBe(1800);
      const blockedKey = mockClient.set.mock.calls[0][0];
      expect(blockedKey).toMatch(/^login:account:blocked:[a-f0-9]{64}$/);
    });

    it('incrementAccountFailures no bloquea bajo el umbral', async () => {
      mockClient.incr.mockResolvedValue(1);
      await expect(LoginRateLimiter.incrementAccountFailures('12345678')).resolves.toBeNull();
      expect(mockClient.set).not.toHaveBeenCalled();
    });

    it('resetAccountCounters borra las dos keys de la cuenta', async () => {
      await LoginRateLimiter.resetAccountCounters('12345678');
      expect(mockClient.del).toHaveBeenCalledTimes(1);
      const [attemptsKey, blockedKey] = mockClient.del.mock.calls[0];
      expect(attemptsKey).toMatch(/^login:account:attempts:[a-f0-9]{64}$/);
      expect(blockedKey).toMatch(/^login:account:blocked:[a-f0-9]{64}$/);
    });
  });

  describe('resiliencia', () => {
    it('si Redis lanza, checkIpBlock hace fail-open a null', async () => {
      mockClient.ttl.mockRejectedValue(new Error('boom'));
      await expect(LoginRateLimiter.checkIpBlock('1.2.3.4')).resolves.toBeNull();
    });
  });
});
