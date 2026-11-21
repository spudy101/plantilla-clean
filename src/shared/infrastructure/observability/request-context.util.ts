// shared/observability/request-context.util.ts
//
// Contexto de la operación en curso (petición HTTP, webhook, ciclo de worker o tarea de sistema) en
// AsyncLocalStorage: logger, auditoría y llamadas externas lo leen solos, sin pasarlo por parámetro.
// Lo abre SIEMPRE runOperation / operationMiddleware (shared/observability/operation.ts).
import asyncHooksModule from 'node:async_hooks';
const { AsyncLocalStorage } = asyncHooksModule;
import crypto from 'node:crypto';

export type OperationSource = 'http' | 'webhook' | 'worker' | 'system';

/**
 * auth.middleware le agrega sessionId/userId al autenticar: la referencia es viva, así que la mutación
 * llega a toda la cadena (y al cierre de la operación).
 */
export interface RequestContext {
  /** Id de la operación (= operations.operation_id). Mismo valor en logs, auditoría y llamadas externas. */
  correlationId: string;
  source: OperationSource | 'unknown';
  /** "POST /admin/api/v1/kyc/persons/:id" o la etiqueta del worker ("notification.email-retry"). */
  name: string;
  parentId?: string | null;
  ip: string | null | undefined;
  userAgent: string | null;
  fingerprintHash: string | null;
  method: string | null;
  path: string | null;
  sessionId?: string | null;
  userId?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export default {
  /** Ejecuta fn con ctx como operación en curso (solo lo usa operation.ts). */
  run: <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn),

  /** La operación en curso, o undefined fuera de toda operación (arranque, tests). */
  get: (): RequestContext | undefined => storage.getStore(),

  /**
   * Fotografía la sesión de origen de una acción del usuario, para persistirla en la fila que esa
   * acción crea (origin_session_id / origin_correlation_id). Se llama al CREAR la fila, nunca al
   * actualizarla: un retry de admin o de worker corre en otra operación y no debe pisar el origen.
   */
  originFromContext: (): { originSessionId: string | null; originCorrelationId: string | null } => {
    const ctx = storage.getStore();
    return {
      originSessionId: ctx?.sessionId ?? null,
      originCorrelationId: ctx?.correlationId ?? null
    };
  },

  /**
   * La operación en curso o, fuera de toda operación, un contexto 'unknown'. 'unknown' en BD
   * (WHERE source = 'unknown') es un termómetro de cobertura: en operación normal da cero filas.
   */
  getSafe: (): RequestContext =>
    storage.getStore() ?? {
      correlationId: `internal-${crypto.randomUUID().slice(0, 8)}`,
      source: 'unknown',
      name: 'unknown',
      ip: 'internal',
      userAgent: null,
      fingerprintHash: null,
      method: null,
      path: null
    }
};
