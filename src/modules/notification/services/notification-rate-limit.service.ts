// Tope por minuto de los envíos masivos a SNS (push) y SES (email), para no pasar la cuota de la cuenta.
//
// Ventana fija por minuto: cada tanda suma su tamaño real al contador del minuto con un INCRBY atómico de
// Redis, así varias instancias comparten el mismo tope sin pisarse (un get + set dejaría pasar de más). Si
// el total pasa el tope, espera al minuto siguiente y vuelve a pedir lugar ahí. Sin Redis, el contador es
// de este proceso (correcto con una sola instancia).
import redisClient from '../../../shared/infra/redis.util';
import constantsModule from '../../../shared/constants';
const { notifications } = constantsModule;
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;

const ONE_MINUTE_MS = 60 * 1000;
/** El contador de un minuto vive un poco más que el minuto. */
const COUNTER_TTL_SECONDS = 120;

type Provider = 'sns' | 'ses';

class NotificationRateLimitService {
  /** Contadores locales (sin Redis): por proveedor, solo el del minuto en curso. */
  private local = new Map<Provider, { key: string; total: number }>();

  /** Pide lugar para `amount` envíos por SNS en el minuto en curso; espera si no hay. */
  checkSNSRateLimit(amount: number) {
    return this.acquire('sns', amount, notifications.rateLimits.snsPerMinute);
  }

  /** Pide lugar para `amount` envíos por SES en el minuto en curso; espera si no hay. */
  checkSESRateLimit(amount: number) {
    return this.acquire('ses', amount, notifications.rateLimits.sesPerMinute);
  }

  async acquire(provider: Provider, amount: number, limitPerMinute: number) {
    if (amount <= 0) {
      return;
    }
    for (;;) {
      const now = Date.now();
      const key = `aws_${provider}_rate:${Math.floor(now / ONE_MINUTE_MS)}`;
      const total = await this.increment(provider, key, amount);
      // Cabe, o es la primera tanda del minuto (una tanda más grande que el tope igual tiene que salir).
      if (total <= limitPerMinute || total === amount) {
        return;
      }
      const waitTime = ONE_MINUTE_MS - (now % ONE_MINUTE_MS);
      logger.warn(`Rate limit ${provider.toUpperCase()} alcanzado, esperando ${waitTime}ms`, { total, limitPerMinute });
      await this._sleep(waitTime);
    }
  }

  private async increment(provider: Provider, key: string, amount: number): Promise<number> {
    const shared = await redisClient.incrBy(key, amount, COUNTER_TTL_SECONDS);
    if (shared !== null) {
      return shared;
    }
    const current = this.local.get(provider);
    const total = (current?.key === key ? current.total : 0) + amount;
    this.local.set(provider, { key, total });
    return total;
  }

  _sleep(ms: number) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }
}

export default Object.assign(new NotificationRateLimitService(), { NotificationRateLimitService });
