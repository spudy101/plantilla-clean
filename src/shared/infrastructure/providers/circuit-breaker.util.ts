// Circuit breaker de las llamadas a proveedores externos (SES, S3, SNS…), uno por producto.
//
//   CLOSED     las llamadas pasan. Cada fallo suma; un éxito pone el contador en cero.
//   OPEN       al llegar a `failureThreshold` fallos dentro de `failuresTtlS`: se rechaza todo
//              (CircuitOpenError, 503) durante `recoveryTimeMs`.
//   HALF_OPEN  pasado ese tiempo, UNA sola llamada (la que gana el permiso de prueba) llega al
//              proveedor. Si sale bien se cierra; si falla vuelve a OPEN por otro `recoveryTimeMs`.
//
// Solo cuentan como fallo los errores que dicen que el proveedor está mal (ver `isFailure`); un
// "dirección inválida" o un "acceso denegado" muestran que el proveedor responde.
//
// El estado vive en Redis (compartido entre instancias, con operaciones atómicas: SET NX) y cae a
// memoria de la instancia si Redis no está. El estado OPEN no vence solo: el circuito se cierra
// únicamente con una prueba exitosa, así cada apertura tiene su cierre (onOpen → onClose).
//
// Umbrales: settings → ResilienceConfig (caché 60s, con defaults si no hay configuración).
// Aperturas y cierres se avisan con registerCallbacks; el módulo integration los registra y audita.

import loggerUtilModule from '../observability/logger.util';
const { logger } = loggerUtilModule;
import AppError from '../../presentation/http/app-error.util';
import { retryAfterSeconds } from '../../presentation/http/retryable';
import redisClient from '../cache/redis.util';
import ResilienceConfig from './resilience-config.util';
import errorMessageModule from '../../kernel/error-message.util';

const { errorMessage } = errorMessageModule;

type BreakerStatus = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Lo que se guarda mientras el circuito está abierto. */
interface OpenState {
  /** Cuándo se abrió (inicio de la ventana de fallback; no cambia al reabrir tras una prueba fallida). */
  openedAt: number;
  /** Desde cuándo se permite la próxima llamada de prueba. */
  probeAt: number;
}

type BreakerCallback = (product: string, openedAt: number) => unknown;

/**
 * Llamada rechazada sin intentar: el circuito del producto está abierto. 503 temporal, con
 * Retry-After = cuánto falta para la próxima llamada de prueba.
 */
class CircuitOpenError extends AppError {
  readonly product: string;
  constructor(product: string, retryInMs: number) {
    super(`Servicio externo no disponible temporalmente (${product})`, 503, 'CIRCUIT_OPEN', null, true);
    this.product = product;
    this.retryAfter = retryAfterSeconds(retryInMs);
  }
}

// Si se perdió la carrera por la llamada de prueba, su resultado llega enseguida.
const PROBE_IN_FLIGHT_RETRY_MS = 1000;

// ── Almacén: Redis con caída a memoria ────────────────────────────────────────

const memory = new Map<string, { value: string; expiresAt: number | null }>();

function memGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlMs: number | null): void {
  memory.set(key, { value, expiresAt: ttlMs === null ? null : Date.now() + ttlMs });
}

/** Corre la operación en Redis; si no está o falla, en memoria. */
async function withStore<T>(
  op: string,
  onRedis: (redis: NonNullable<ReturnType<typeof redisClient.getClient>>) => Promise<T>,
  onMemory: () => T
): Promise<T> {
  const redis = redisClient.isAvailable() ? redisClient.getClient() : null;
  if (redis) {
    try {
      return await onRedis(redis);
    } catch (error) {
      logger.warn(`[CircuitBreaker] Redis ${op} falló, usando memoria`, { error: errorMessage(error) });
    }
  }
  return onMemory();
}

const store = {
  get: (key: string) =>
    withStore(
      'get',
      r => r.get(key),
      () => memGet(key)
    ),

  /** Guarda el valor; con `nx` solo si la clave no existe. Devuelve si lo guardó. */
  set: (key: string, value: string, { nx = false, ttlMs = null }: { nx?: boolean; ttlMs?: number | null } = {}) =>
    withStore(
      'set',
      async r => {
        let res: string | null;
        if (ttlMs === null) {
          res = nx ? await r.set(key, value, 'NX') : await r.set(key, value);
        } else {
          res = nx ? await r.set(key, value, 'PX', ttlMs, 'NX') : await r.set(key, value, 'PX', ttlMs);
        }
        return res === 'OK';
      },
      () => {
        if (nx && memGet(key) !== null) {
          return false;
        }
        memSet(key, value, ttlMs);
        return true;
      }
    ),

  /** Borra las claves. Devuelve cuántas existían. */
  del: (...names: string[]) =>
    withStore(
      'del',
      r => r.del(...names),
      () => {
        const existing = names.filter(k => memGet(k) !== null);
        existing.forEach(k => memory.delete(k));
        return existing.length;
      }
    ),

  /** Suma 1; la clave vence `ttlS` segundos después del primer incremento. */
  incr: (key: string, ttlS: number) =>
    withStore(
      'incr',
      async r => {
        const count = await r.incr(key);
        if (count === 1) {
          await r.expire(key, ttlS);
        }
        return count;
      },
      () => {
        const current = Number(memGet(key) ?? 0) + 1;
        const entry = memory.get(key);
        memory.set(key, { value: String(current), expiresAt: entry?.expiresAt ?? Date.now() + ttlS * 1000 });
        return current;
      }
    )
};

const keys = (product: string) => ({
  state: `cb:${product}:state`,
  failures: `cb:${product}:failures`,
  probe: `cb:${product}:probe`
});

// ── Breaker ───────────────────────────────────────────────────────────────────

class CircuitBreaker {
  private onOpen: BreakerCallback | null = null;
  private onClose: BreakerCallback | null = null;

  /** Qué hacer al abrirse y al cerrarse un circuito. Lo conecta src/app.ts (módulo integration). */
  registerCallbacks({
    onOpen = null,
    onClose = null
  }: { onOpen?: BreakerCallback | null; onClose?: BreakerCallback | null } = {}): void {
    this.onOpen = onOpen;
    this.onClose = onClose;
  }

  /**
   * Ejecuta `fn` protegida por el circuito de `product`.
   * - Circuito abierto → CircuitOpenError sin llamar a `fn`.
   * - `fn` lanza y `isFailure(error)` → cuenta como fallo del proveedor. Si no, el proveedor respondió:
   *   cuenta como éxito para el circuito, y el error se propaga igual.
   */
  async execute<T>(
    product: string,
    fn: () => Promise<T>,
    { isFailure = () => true }: { isFailure?: (error: unknown) => boolean } = {}
  ): Promise<T> {
    const { ticket, retryInMs } = await this.acquire(product);
    if (ticket === 'rejected') {
      throw new CircuitOpenError(product, retryInMs);
    }
    const probe = ticket === 'probe';
    let result: T;
    try {
      result = await fn();
    } catch (error) {
      await (isFailure(error) ? this.recordFailure(product, probe) : this.recordSuccess(product));
      throw error;
    }
    await this.recordSuccess(product);
    return result;
  }

  /** Estado actual (para el dashboard de integraciones). */
  async getStatus(product: string) {
    const k = keys(product);
    const [state, failures] = await Promise.all([this.readState(product), store.get(k.failures)]);
    let status: BreakerStatus = 'CLOSED';
    if (state) {
      status = Date.now() < state.probeAt ? 'OPEN' : 'HALF_OPEN';
    }
    return {
      product,
      status,
      failures: failures ? Number.parseInt(failures, 10) : 0,
      openedAt: state?.openedAt ?? null,
      openedAtISO: state ? new Date(state.openedAt).toISOString() : null
    };
  }

  // ── Transiciones ──

  private async acquire(product: string): Promise<{ ticket: 'closed' | 'probe' | 'rejected'; retryInMs: number }> {
    const state = await this.readState(product);
    if (!state) {
      return { ticket: 'closed', retryInMs: 0 };
    }
    const untilProbe = state.probeAt - Date.now();
    if (untilProbe > 0) {
      return { ticket: 'rejected', retryInMs: untilProbe };
    }
    // HALF_OPEN: una sola llamada de prueba entre todas las instancias. El permiso vence por si la
    // prueba nunca termina (proceso caído), para que otra pueda intentarlo.
    const { recoveryTimeMs } = (await ResilienceConfig.get()).circuitBreaker;
    const won = await store.set(keys(product).probe, '1', { nx: true, ttlMs: recoveryTimeMs });
    if (won) {
      logger.info(`[CircuitBreaker] ${product} → HALF_OPEN (llamada de prueba)`);
    }
    return won ? { ticket: 'probe', retryInMs: 0 } : { ticket: 'rejected', retryInMs: PROBE_IN_FLIGHT_RETRY_MS };
  }

  private async recordSuccess(product: string): Promise<void> {
    const k = keys(product);
    const state = await this.readState(product);
    await store.del(k.failures);
    if (!state) {
      return;
    }
    // Solo quien borra el estado avisa el cierre (varias instancias pueden ver el éxito a la vez).
    const deleted = await store.del(k.state, k.probe);
    if (deleted > 0) {
      logger.info(`[CircuitBreaker] ${product} → CLOSED (recuperado)`);
      this.emit(this.onClose, product, state.openedAt);
    }
  }

  private async recordFailure(product: string, probe: boolean): Promise<void> {
    const k = keys(product);
    const { failureThreshold, recoveryTimeMs, failuresTtlS } = (await ResilienceConfig.get()).circuitBreaker;

    if (probe) {
      // La prueba falló: vuelve a OPEN, misma ventana de fallback (no se avisa otra apertura).
      const state = await this.readState(product);
      if (state) {
        await store.set(
          k.state,
          JSON.stringify({ openedAt: state.openedAt, probeAt: Date.now() + recoveryTimeMs } satisfies OpenState)
        );
        logger.warn(`[CircuitBreaker] ${product} → OPEN (la prueba falló)`);
      }
      await store.del(k.probe);
      return;
    }

    const failures = await store.incr(k.failures, failuresTtlS);
    logger.warn(`[CircuitBreaker] ${product} — fallo ${failures}/${failureThreshold}`);
    if (failures < failureThreshold) {
      return;
    }
    const openedAt = Date.now();
    const opened = await store.set(
      k.state,
      JSON.stringify({ openedAt, probeAt: openedAt + recoveryTimeMs } satisfies OpenState),
      { nx: true }
    );
    if (opened) {
      logger.warn(`[CircuitBreaker] ${product} → OPEN (${failureThreshold} fallos)`);
      this.emit(this.onOpen, product, openedAt);
    }
  }

  private async readState(product: string): Promise<OpenState | null> {
    const raw = await store.get(keys(product).state);
    return raw ? (JSON.parse(raw) as OpenState) : null;
  }

  /** Avisa fuera del flujo de la llamada: un callback lento o que falla no la afecta. */
  private emit(callback: BreakerCallback | null, product: string, openedAt: number): void {
    if (!callback) {
      return;
    }
    setImmediate(() => {
      Promise.resolve()
        .then(() => callback(product, openedAt))
        .catch((error: unknown) =>
          logger.error('[CircuitBreaker] Falló el aviso de cambio de estado', { product, error: errorMessage(error) })
        );
    });
  }

  /** Solo para tests: vacía el estado en memoria. */
  _resetMemory(): void {
    memory.clear();
  }
}

export { CircuitOpenError };
export default new CircuitBreaker();
