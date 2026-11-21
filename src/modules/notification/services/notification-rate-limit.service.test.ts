// NotificationRateLimitService — tope por minuto de los envíos masivos a SNS/SES. Probamos: la clave sale
// del minuto actual, cada tanda suma su tamaño real con un INCRBY atómico (Redis), espera al minuto
// siguiente solo si se pasa del tope, y sin Redis cuenta en el proceso. `_sleep` y `Date.now()` se fijan
// para no depender del reloj real.

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
}));
jest.mock('../../../shared/infrastructure/cache/redis.util', () => ({ incrBy: jest.fn() }));

import { mocked } from 'tests/helpers/mock';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = mocked(loggerUtilModule);
import redisUtilModule from '../../../shared/infrastructure/cache/redis.util';
const redis = mocked(redisUtilModule);
import rateLimitModule from './notification-rate-limit.service';

const { NotificationRateLimitService } = rateLimitModule;
const ONE_MINUTE_MS = 60 * 1000;
// Un instante fijo dentro de un minuto: now % 60000 = 20000 → espera esperada = 40000.
const FIXED_NOW = 90 * ONE_MINUTE_MS + 20 * 1000;
const MINUTE = Math.floor(FIXED_NOW / ONE_MINUTE_MS);
const EXPECTED_WAIT = ONE_MINUTE_MS - (FIXED_NOW % ONE_MINUTE_MS);

describe('NotificationRateLimitService', () => {
  let rateLimit: InstanceType<typeof NotificationRateLimitService>;
  let sleepSpy: jest.SpyInstance;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit = new NotificationRateLimitService();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    sleepSpy = jest.spyOn(rateLimit, '_sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('suma el tamaño real de la tanda al contador del minuto (INCRBY atómico) y no espera si cabe', async () => {
    redis.incrBy.mockResolvedValue(150);

    await rateLimit.checkSNSRateLimit(37);

    expect(redis.incrBy).toHaveBeenCalledWith(`aws_sns_rate:${MINUTE}`, 37, 120);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('usa claves separadas para SES', async () => {
    redis.incrBy.mockResolvedValue(10);

    await rateLimit.checkSESRateLimit(10);

    expect(redis.incrBy).toHaveBeenCalledWith(`aws_ses_rate:${MINUTE}`, 10, 120);
  });

  it('si se pasa del tope espera al fin del minuto y vuelve a pedir lugar en el siguiente', async () => {
    redis.incrBy.mockResolvedValueOnce(350).mockResolvedValueOnce(100);
    nowSpy.mockReturnValueOnce(FIXED_NOW).mockReturnValue(FIXED_NOW + EXPECTED_WAIT);

    await rateLimit.checkSNSRateLimit(100);

    expect(sleepSpy).toHaveBeenCalledWith(EXPECTED_WAIT);
    expect(logger.warn).toHaveBeenCalled();
    expect(redis.incrBy).toHaveBeenNthCalledWith(2, `aws_sns_rate:${MINUTE + 1}`, 100, 120);
  });

  it('la primera tanda del minuto sale aunque sea más grande que el tope', async () => {
    redis.incrBy.mockResolvedValue(500);

    await rateLimit.checkSESRateLimit(500);

    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('sin Redis cuenta en el proceso, por proveedor', async () => {
    redis.incrBy.mockResolvedValue(null);

    await rateLimit.checkSESRateLimit(150);
    await rateLimit.checkSNSRateLimit(250);
    expect(sleepSpy).not.toHaveBeenCalled();

    // SES: 150 + 100 = 250 > 200 → espera
    nowSpy.mockReturnValueOnce(FIXED_NOW).mockReturnValue(FIXED_NOW + EXPECTED_WAIT);
    await rateLimit.checkSESRateLimit(100);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it('una tanda vacía no cuenta', async () => {
    await rateLimit.checkSNSRateLimit(0);
    expect(redis.incrBy).not.toHaveBeenCalled();
  });
});
