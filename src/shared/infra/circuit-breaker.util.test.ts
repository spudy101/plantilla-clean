// Circuit breaker: máquina de estados CLOSED → OPEN → HALF_OPEN → CLOSED, en memoria (Redis no
// disponible) y con un Redis falso para el camino compartido. Umbrales chicos y reloj controlado.

jest.mock('./redis.util', () => ({ getClient: jest.fn(), isAvailable: jest.fn() }));

jest.mock('./resilience-config.util', () => ({
  HARD_DEFAULTS: { circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 60000, failuresTtlS: 300 } },
  get: jest.fn()
}));

jest.mock('../observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { mocked } from 'tests/helpers/mock';
import redisClientModule from './redis.util';
const redisClient = mocked(redisClientModule);
import ResilienceConfigModule from './resilience-config.util';
const ResilienceConfig = mocked(ResilienceConfigModule);
import breaker, { CircuitOpenError } from './circuit-breaker.util';

// Abre a los 3 fallos, prueba a los 1000 ms, la ventana de conteo dura 300 s.
const THRESHOLDS = { failureThreshold: 3, recoveryTimeMs: 1000, failuresTtlS: 300 };
const P = 'ses';

const ok = () => Promise.resolve('ok');
const boom = () => Promise.reject(new Error('caído'));
const tick = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

let now = 0;

async function failTimes(n: number, product = P) {
  for (let i = 0; i < n; i++) {
    await expect(breaker.execute(product, boom)).rejects.toThrow('caído');
  }
}

describe('CircuitBreaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    breaker._resetMemory();
    breaker.registerCallbacks({});
    redisClient.isAvailable.mockReturnValue(false);
    redisClient.getClient.mockReturnValue(null);
    ResilienceConfig.get.mockResolvedValue({ circuitBreaker: { ...THRESHOLDS } } as never);
    now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => jest.restoreAllMocks());

  it('CLOSED: deja pasar y devuelve el resultado', async () => {
    await expect(breaker.execute(P, ok)).resolves.toBe('ok');
    expect(await breaker.getStatus(P)).toMatchObject({ status: 'CLOSED', failures: 0, openedAt: null });
  });

  it('bajo el umbral cuenta los fallos y sigue cerrado', async () => {
    await failTimes(2);
    expect(await breaker.getStatus(P)).toMatchObject({ status: 'CLOSED', failures: 2 });
  });

  it('un éxito pone el contador en cero', async () => {
    await failTimes(2);
    await breaker.execute(P, ok);
    await failTimes(2);
    expect((await breaker.getStatus(P)).status).toBe('CLOSED');
  });

  it('al llegar al umbral abre y rechaza sin llamar al proveedor (503)', async () => {
    await failTimes(3);
    expect(await breaker.getStatus(P)).toMatchObject({ status: 'OPEN', openedAt: 0 });

    const fn = jest.fn(ok);
    const err = await breaker.execute(P, fn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CircuitOpenError);
    expect(err).toMatchObject({ statusCode: 503, code: 'CIRCUIT_OPEN', product: P });
    expect(fn).not.toHaveBeenCalled();
  });

  it('los errores que no son del proveedor no cuentan (isFailure → false)', async () => {
    const clientError = () => Promise.reject(Object.assign(new Error('dirección inválida'), { name: 'MessageRejected' }));
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(P, clientError, { isFailure: () => false })).rejects.toThrow('dirección inválida');
    }
    expect((await breaker.getStatus(P)).status).toBe('CLOSED');
  });

  describe('HALF_OPEN', () => {
    beforeEach(async () => {
      await failTimes(3);
      now = 1500; // pasó recoveryTimeMs
    });

    it('deja pasar UNA sola llamada de prueba aunque lleguen varias a la vez', async () => {
      let release!: () => void;
      const slow = jest.fn(
        () =>
          new Promise<string>(resolve => {
            release = () => resolve('ok');
          })
      );
      const probe = breaker.execute(P, slow);
      await tick();
      const others = await Promise.all([1, 2, 3].map(() => breaker.execute(P, ok).catch((e: unknown) => e)));
      expect(others.every(e => e instanceof CircuitOpenError)).toBe(true);
      expect(slow).toHaveBeenCalledTimes(1);
      release();
      await expect(probe).resolves.toBe('ok');
    });

    it('prueba exitosa → CLOSED y avisa onClose con el openedAt original', async () => {
      const onClose = jest.fn();
      breaker.registerCallbacks({ onClose });
      expect((await breaker.getStatus(P)).status).toBe('HALF_OPEN');

      await breaker.execute(P, ok);
      await tick();

      expect(await breaker.getStatus(P)).toMatchObject({ status: 'CLOSED', failures: 0 });
      expect(onClose).toHaveBeenCalledWith(P, 0);
    });

    it('prueba fallida → vuelve a OPEN de inmediato, aunque el contador de fallos haya vencido', async () => {
      const onOpen = jest.fn();
      breaker.registerCallbacks({ onOpen });
      now = 400_000; // > failuresTtlS: el contador ya venció
      await failTimes(1);

      expect(await breaker.getStatus(P)).toMatchObject({ status: 'OPEN', openedAt: 0 });
      await expect(breaker.execute(P, ok)).rejects.toBeInstanceOf(CircuitOpenError);

      // misma ventana de fallback: no se avisa otra apertura
      await tick();
      expect(onOpen).not.toHaveBeenCalled();

      // y pasado otro recoveryTimeMs, otra prueba
      now = 401_500;
      await expect(breaker.execute(P, ok)).resolves.toBe('ok');
    });

    it('una prueba con error del cliente muestra que el proveedor responde → CLOSED', async () => {
      await expect(breaker.execute(P, boom, { isFailure: () => false })).rejects.toThrow('caído');
      expect((await breaker.getStatus(P)).status).toBe('CLOSED');
    });
  });

  it('OPEN no vence solo: sin tráfico sigue abierto (para que cada apertura tenga su cierre)', async () => {
    await failTimes(3);
    now = 10 * 60 * 60 * 1000; // 10 horas
    expect((await breaker.getStatus(P)).status).toBe('HALF_OPEN');
    expect((await breaker.getStatus(P)).openedAt).toBe(0);
  });

  it('onOpen se avisa una sola vez por apertura (fallos tardíos no reabren)', async () => {
    const onOpen = jest.fn();
    breaker.registerCallbacks({ onOpen });
    await failTimes(3);
    // llamadas que empezaron antes de abrir y fallan después
    await (breaker as unknown as { recordFailure: (p: string, probe: boolean) => Promise<void> }).recordFailure(P, false);
    await tick();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(P, 0);
  });

  it('un callback que falla no afecta la llamada', async () => {
    breaker.registerCallbacks({ onOpen: () => Promise.reject(new Error('BD caída')) });
    await failTimes(3);
    await tick();
    await tick();
    expect((await breaker.getStatus(P)).status).toBe('OPEN');
  });

  it('cada producto tiene su propio circuito', async () => {
    await failTimes(3, 's3');
    expect((await breaker.getStatus('s3')).status).toBe('OPEN');
    await expect(breaker.execute('ses', ok)).resolves.toBe('ok');
  });

  describe('con Redis', () => {
    // Redis falso con la semántica que usa el breaker: GET, SET (PX, NX), DEL (cuenta), INCR, EXPIRE.
    function fakeRedis() {
      const store = new Map<string, string>();
      return {
        store,
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string, ...args: unknown[]) => {
          if (args.includes('NX') && store.has(k)) {
            return null;
          }
          store.set(k, v);
          return 'OK';
        }),
        del: jest.fn(async (...ks: string[]) => ks.filter(k => store.delete(k)).length),
        incr: jest.fn(async (k: string) => {
          const n = Number(store.get(k) ?? 0) + 1;
          store.set(k, String(n));
          return n;
        }),
        expire: jest.fn(async () => 1)
      };
    }

    it('guarda el estado en Redis (compartido) y abre con SET NX, sin TTL', async () => {
      const redis = fakeRedis();
      redisClient.isAvailable.mockReturnValue(true);
      redisClient.getClient.mockReturnValue(redis as never);

      await failTimes(3);

      expect(redis.expire).toHaveBeenCalledWith('cb:ses:failures', 300);
      expect(redis.set).toHaveBeenCalledWith('cb:ses:state', expect.any(String), 'NX');
      expect(JSON.parse(redis.store.get('cb:ses:state')!)).toEqual({ openedAt: 0, probeAt: 1000 });
    });

    it('el permiso de prueba es un SET NX con vencimiento', async () => {
      const redis = fakeRedis();
      redisClient.isAvailable.mockReturnValue(true);
      redisClient.getClient.mockReturnValue(redis as never);
      await failTimes(3);
      now = 1500;

      await breaker.execute(P, ok);
      expect(redis.set).toHaveBeenCalledWith('cb:ses:probe', '1', 'PX', 1000, 'NX');
      expect(redis.store.has('cb:ses:state')).toBe(false);
    });

    it('si Redis falla, sigue funcionando en memoria', async () => {
      const broken = {
        get: jest.fn(() => Promise.reject(new Error('redis down'))),
        set: jest.fn(),
        del: jest.fn(),
        incr: jest.fn(),
        expire: jest.fn()
      };
      redisClient.isAvailable.mockReturnValue(true);
      redisClient.getClient.mockReturnValue(broken as never);
      await expect(breaker.execute(P, ok)).resolves.toBe('ok');
    });
  });
});
