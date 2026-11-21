// shared/observability/operation.ts
//
// ÚNICO punto de entrada de una operación, sea cual sea su origen:
//   - HTTP / webhook → operationMiddleware (el primero de la app)
//   - worker / sistema → runOperation({ source, name }, fn)
//
// Cada operación: genera su id (= correlationId), lo publica en AsyncLocalStorage para logs, auditoría y
// llamadas externas, inserta su fila en `operations` al empezar (running) y la cierra al terminar
// (success | failure, duración, error). Escribir la traza nunca rompe la operación: si falla, se loguea.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import requestContext, { type OperationSource, type RequestContext } from './request-context.util';
import operationRepository from './operation.repository';
import loggerUtilModule from './logger.util';
const { logger } = loggerUtilModule;
import { auditInfraEvent } from './audit-hook';
import DeviceFingerprintUtil from '../security/device-fingerprint.util';
import errorMessageModule from '../../kernel/error-message.util';
const { errorMessage } = errorMessageModule;

/** Cómo terminó: lo que se escribe al cerrar la fila. */
interface Outcome {
  status: 'success' | 'failure';
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

interface Started {
  ctx: RequestContext;
  startedAt: Date;
  /** El insert inicial: el cierre lo espera para no actualizar una fila que todavía no existe. */
  persisted: Promise<unknown>;
}

const MAX_NAME = 255;
const MAX_CLIENT_REQUEST_ID = 128;

const newOperationId = (): string => crypto.randomUUID();

function begin(ctx: RequestContext, clientRequestId: string | null = null): Started {
  const startedAt = new Date();
  const persisted = operationRepository
    .start({
      operationId: ctx.correlationId,
      parentId: ctx.parentId ?? null,
      clientRequestId: clientRequestId?.slice(0, MAX_CLIENT_REQUEST_ID) ?? null,
      source: ctx.source as OperationSource,
      name: ctx.name.slice(0, MAX_NAME),
      ip: ctx.ip ?? null
    })
    .catch((error: unknown) => {
      logger.warn('No se pudo registrar el inicio de la operación', { correlationId: ctx.correlationId, error: errorMessage(error) });
    });
  return { ctx, startedAt, persisted };
}

function end({ ctx, startedAt, persisted }: Started, outcome: Outcome): void {
  const endedAt = new Date();
  void persisted
    .then(() =>
      operationRepository.finish(ctx.correlationId, {
        source: ctx.source as OperationSource,
        name: ctx.name.slice(0, MAX_NAME),
        userId: ctx.userId ?? null,
        sessionId: ctx.sessionId ?? null,
        status: outcome.status,
        httpStatus: outcome.httpStatus ?? null,
        errorCode: outcome.errorCode ?? null,
        errorMessage: outcome.errorMessage ?? null,
        endedAt,
        durationMs: endedAt.getTime() - startedAt.getTime()
      })
    )
    .catch((error: unknown) => {
      logger.warn('No se pudo registrar el cierre de la operación', { correlationId: ctx.correlationId, error: errorMessage(error) });
    });
}

/**
 * Ejecuta fn como una operación propia (worker o sistema). Si se llama dentro de otra operación, esa
 * queda como parent_id.
 *
 * Errores: se registran (fila en failure + log). Un worker NUNCA tumba el proceso del cron: su error se
 * traga (y alerta como WORKER_CYCLE_FAILED); en el resto se relanza.
 */
function runOperation<T>(
  { source, name }: { source: Exclude<OperationSource, 'http' | 'webhook'>; name: string },
  fn: () => T | Promise<T>
): Promise<T | undefined> {
  const ctx: RequestContext = {
    correlationId: newOperationId(),
    source,
    name,
    parentId: requestContext.get()?.correlationId ?? null,
    ip: 'internal',
    userAgent: null,
    fingerprintHash: null,
    method: null,
    path: name
  };
  const op = begin(ctx);

  return requestContext.run(ctx, async () => {
    try {
      const result = await fn();
      end(op, { status: 'success' });
      return result;
    } catch (error) {
      end(op, { status: 'failure', errorCode: 'UNHANDLED_ERROR', errorMessage: errorMessage(error) });
      logger.error(`[${source}] ${name} terminó con error`, {
        error: errorMessage(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      if (source !== 'worker') {
        throw error;
      }
      auditInfraEvent({
        action: 'WORKER_CYCLE_FAILED',
        actorId: 'system',
        details: { worker: name, error: errorMessage(error) },
        outcome: 'failure',
        entityType: 'Worker'
      });
      return undefined;
    }
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

// Sin fila ni log: health checks, raíz y los assets/JSON de Swagger.
const UNTRACKED = /^\/(?:health|)$|\/(?:docs|docs\.json|swagger-ui[^/]*|favicon[^/]*)$/;

const headerValue = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

// 400/404/422 → info (lo resuelve el usuario); el resto ≥ 400 → warn (seguridad/infra); < 400 → info.
const USER_RESOLVABLE = new Set([400, 404, 422]);
const httpLogLevel = (status: number) => (USER_RESOLVABLE.has(status) || status < 400 ? 'info' : 'warn');

/** Plantilla de la ruta ("POST /admin/api/v1/kyc/persons/:id"): agrupa sin ids. Antes de rutear, la URL. */
const routeName = (req: Request) =>
  req.route ? `${req.method} ${req.baseUrl}${String(req.route.path)}` : `${req.method} ${req.path}`;

/**
 * Primer middleware de la app. El id de la operación lo generamos SIEMPRE nosotros: el
 * X-Correlation-Id / X-Request-Id que mande el cliente se guarda aparte (client_request_id), nunca como
 * clave. La respuesta lleva el nuestro en X-Correlation-Id.
 */
function operationMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = newOperationId();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  const fingerprintHash = DeviceFingerprintUtil.generateFromRequest(req);
  const ctx: RequestContext = {
    correlationId,
    source: 'http',
    name: `${req.method} ${req.path}`,
    parentId: null,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    fingerprintHash,
    method: req.method,
    path: req.originalUrl
  };
  // Los controllers leen ip/userAgent/fingerprint de acá para pasarlos a los services
  res.locals.auditContext = ctx;
  res.locals.fingerprintHash = fingerprintHash;

  if (UNTRACKED.test(req.path)) {
    requestContext.run(ctx, next);
    return;
  }

  const op = begin(ctx, headerValue(req.headers['x-correlation-id']) ?? headerValue(req.headers['x-request-id']));

  res.once('close', () => {
    ctx.name = routeName(req);
    const finished = res.writableFinished;
    const status = res.statusCode;
    const error = res.locals.operationError as { code?: string; message?: string } | undefined;
    end(op, {
      status: finished && status < 400 ? 'success' : 'failure',
      httpStatus: status,
      errorCode: finished ? (error?.code ?? null) : 'CLIENT_CLOSED_REQUEST',
      errorMessage: error?.message ?? null
    });
    logger[httpLogLevel(status)]('HTTP', {
      correlationId,
      operation: ctx.name,
      url: req.originalUrl,
      status,
      durationMs: Date.now() - op.startedAt.getTime(),
      userId: ctx.userId ?? undefined,
      ...(finished ? {} : { aborted: true })
    });
  });

  requestContext.run(ctx, next);
}

/** Marca la operación HTTP en curso con otro origen (p. ej. 'webhook' en las rutas de webhooks). */
const markOperationSource = (source: Extract<OperationSource, 'webhook'>) => (_req: Request, _res: Response, next: NextFunction) => {
  const ctx = requestContext.get();
  if (ctx) {
    ctx.source = source;
  }
  next();
};

export { runOperation, operationMiddleware, markOperationSource };
export default { runOperation, operationMiddleware, markOperationSource };
