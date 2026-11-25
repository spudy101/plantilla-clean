// Regresión del adaptador Redis del refresh token (infrastructure/security/redis-refresh-token.store.ts).
//
// Regresión: la ventana de gracia de rotación se guardaba con JSON.stringify y se leía con
// JSON.parse sobre lo que redisClient.get YA devuelve parseado → getRotation siempre era null.
// El Redis falso replica la serialización real de shared/utils/redis.util (set serializa objetos,
// get parsea JSON) para que el test detecte cualquier doble (de)serialización.

const mockStore = new Map();

jest.mock('../../../../shared/infrastructure/cache/redis.util', () => ({
  isAvailable: () => true,
  set: jest.fn((key, value) => {
    mockStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return Promise.resolve(true);
  }),
  get: jest.fn(key => {
    const raw = mockStore.get(key);
    if (raw === undefined) {
      return Promise.resolve(null);
    }
    try {
      return Promise.resolve(JSON.parse(raw));
    } catch {
      return Promise.resolve(raw);
    }
  })
}));
jest.mock('../../../../shared/infrastructure/observability/logger.util', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { mocked } from 'tests/helpers/mock';
import RefreshTokenStore from './redis-refresh-token.store';
import redisClientModule from '../../../../shared/infrastructure/cache/redis.util';
const redisClient = mocked(redisClientModule);

const TOKENS = { accessToken: 'a-1', refreshToken: 'r-1', expiresIn: 900 };

describe('RefreshTokenStore — ventana de gracia de rotación', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('devuelve el mismo par de tokens que se guardó al rotar', async () => {
    await expect(RefreshTokenStore.saveRotation('jti-old', TOKENS)).resolves.toBe(true);

    await expect(RefreshTokenStore.getRotation('jti-old')).resolves.toEqual(TOKENS);
  });

  it('guarda el objeto y deja la serialización a redisClient (sin JSON.stringify doble)', async () => {
    await RefreshTokenStore.saveRotation('jti-old', TOKENS);

    const [, storedValue] = redisClient.set.mock.calls[0];
    expect(storedValue).toEqual(TOKENS);
  });

  it('sigue leyendo valores guardados con la versión anterior (string JSON doblemente serializado)', async () => {
    const legacyKey = RefreshTokenStore._buildRotatedKey('jti-legacy');
    mockStore.set(legacyKey, JSON.stringify(JSON.stringify(TOKENS)));

    await expect(RefreshTokenStore.getRotation('jti-legacy')).resolves.toEqual(TOKENS);
  });

  it('sin rotación previa devuelve null', async () => {
    await expect(RefreshTokenStore.getRotation('jti-inexistente')).resolves.toBeNull();
  });
});
