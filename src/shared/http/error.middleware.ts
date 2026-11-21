// === RF-OPS-01: Pipeline DevSecOps, Infraestructura Base ===
// shared/middlewares/error.middleware.ts

import type { NextFunction, Request, Response } from 'express';
import ApiResponse from './app-response.util';
import AppError from './app-error.util';
import loggerUtilModule from '../observability/logger.util';
const { logger, sanitizeForLog } = loggerUtilModule;
import { auditInfraEvent } from '../observability/audit-hook';
import constantsModule from '../constants';
const { HTTP_STATUS, ERROR_CODES, ERROR_MESSAGES, server, FIELD_LABELS, DEFAULT_FIELD_LABEL } = constantsModule;
import { isDatabaseUnavailable, isTransactionConflict } from '../database/database-errors';

// Cuánto esperar antes de reintentar cuando la base no está disponible o hubo un conflicto de
// transacción que no se resolvió repitiéndola (ver docs/errors-and-retries.md).
const DATABASE_UNAVAILABLE_RETRY_AFTER_S = 5;
const TRANSACTION_CONFLICT_RETRY_AFTER_S = 1;

/**
 * Lo que el handler lee de un error. Puede llegar cualquier cosa lanzada (AppError, errores de
 * Prisma/Multer/JWT, Error nativo): todos los campos son opcionales.
 */
interface HandledError {
  name?: string;
  message?: string;
  stack?: string;
  statusCode?: number;
  code?: string;
  details?: unknown;
  retryAfter?: number | null;
  isOperational?: boolean;
  /** PrismaClientKnownRequestError: campos de la restricción violada (según versión/adaptador) */
  meta?: {
    target?: string[] | string;
    driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } };
  };
}

/** Campos de la restricción que violó un error de Prisma, en snake_case (como FIELD_LABELS). */
function _prismaConstraintFields(err: HandledError): string[] {
  const target = err.meta?.target ?? err.meta?.driverAdapterError?.cause?.constraint?.fields ?? [];
  const fields = Array.isArray(target) ? target : [target];
  return fields.map(f => String(f).replace(/"/g, '').replace(/[A-Z]/g, c => `_${c.toLowerCase()}`));
}

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => unknown;

// Rechazos de seguridad que además se auditan (el resto de errores solo va al log y a `operations`):
//   AUTH_FAILURE  — 401 · token inválido, expirado o ausente
//   ACCESS_DENIED — 403 · autenticado pero sin permiso
const _securityAuditAction = (err: HandledError): 'AUTH_FAILURE' | 'ACCESS_DENIED' | null => {
  const status = err.statusCode || 500;
  if (status === 401 || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return 'AUTH_FAILURE';
  }
  return status === 403 ? 'ACCESS_DENIED' : null;
};

// Nivel de log para un AppError de negocio (isOperational=false, 4xx):
//   400/404/422 → info  (el usuario lo resuelve solo: corrige input, recurso ausente)
//   resto (401/403/409/429…) → warn  (admin/seguridad/infra resuelve la causa raíz)
const USER_RESOLVABLE_STATUSES = new Set([400, 404, 422]);
const _resolveBusinessLogLevel = (statusCode: number) => (USER_RESOLVABLE_STATUSES.has(statusCode) ? 'info' : 'warn');

class ErrorMiddleware {
  // === RF-LP-03: Accesibilidad — Middleware global de errores ===
  /**
   * Manejador global de errores — debe registrarse al final del pipeline en app.js.
   * app.use(ErrorMiddleware.handleError)
   */
  // [RF-LP-03] | CA-05 | UNPROCESSABLE_ENTITY con details[]
  // preserva field/message/value → cumple identificación de campo.
  // Otros AppError (badRequest, conflict) solo propagan message
  // sin field → incumplimiento parcial CA-05.
  // TODO [RF-LP-03][CA-05]: estandarizar errores de negocio
  // para incluir field cuando el error está asociado a un campo.
  static _handleAppError(err: AppError, res: Response, req: Request): Response {
    if (err.code === 'UNPROCESSABLE_ENTITY' && Array.isArray(err.details)) {
      return ApiResponse.validationError(res, err.details);
    }

    return ApiResponse.error(
      res,
      err.message,
      err.statusCode,
      err.code,
      { ...(err.details && typeof err.details === 'object' ? err.details : {}), correlationId: req.correlationId },
      { retryable: err.retryable, retryAfter: err.retryAfter }
    );
  }

  // [RF-LP-03] | CA-05 | JWT, RateLimit, Multer con mensajes
  // genéricos. Aceptable para errores de sistema, no de formulario.
  static _handleKnownErrors(err: HandledError, res: Response, req: Request): Response | null {
    // Primero lo temporal de la base: no es culpa de la petición, y un 500 haría que el cliente no reintente
    if (isDatabaseUnavailable(err)) {
      return ApiResponse.error(
        res,
        'La base de datos no está disponible en este momento. Intentá de nuevo en unos segundos',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'DATABASE_UNAVAILABLE',
        { correlationId: req.correlationId },
        { retryAfter: DATABASE_UNAVAILABLE_RETRY_AFTER_S }
      );
    }
    if (isTransactionConflict(err)) {
      // El Unit of Work ya repitió la transacción y siguió chocando con otra: reintentar más tarde funciona
      return ApiResponse.error(
        res,
        'La operación chocó con otra en curso sobre los mismos datos. Intentá de nuevo',
        HTTP_STATUS.CONFLICT,
        'TRANSACTION_CONFLICT',
        { correlationId: req.correlationId },
        { retryable: true, retryAfter: TRANSACTION_CONFLICT_RETRY_AFTER_S }
      );
    }
    if (err.name === 'PrismaClientKnownRequestError') {
      return ErrorMiddleware._handlePrismaError(err, res, req.correlationId);
    }
    if (err.name === 'JsonWebTokenError') {
      return ApiResponse.unauthorized(res, ERROR_MESSAGES.TOKEN_INVALID);
    }
    if (err.name === 'TokenExpiredError') {
      return ApiResponse.unauthorized(res, ERROR_MESSAGES.TOKEN_EXPIRED);
    }
    if (err.statusCode === 429 || err.name === 'RateLimitError') {
      return ApiResponse.tooManyRequests(res, err.message || ERROR_MESSAGES.RATE_LIMIT_EXCEEDED, err.retryAfter ?? null);
    }
    if (err.name === 'MulterError') {
      return ApiResponse.badRequest(res, `Error de carga: ${err.message}`);
    }
    return null;
  }

  // [RF-OPS-01] | CA-03 | Registra errores con contexto completo:
  // correlationId, path, method, statusCode, userId, ip.
  // En producción incluye primera línea del stack saneada.
  static _logError(err: HandledError, req: Request, statusCode: number, errorCode: string): void {
    const errorContext = {
      correlationId: req.correlationId,
      message: err.message,
      // [RF-OPS-01][CA-03]: en producción se incluye solo la primera
      // línea del stack saneada para trazabilidad sin exponer internos.
      // TODO [RF-OPS-01][CA-03]: evaluar exponer stack completo saneado
      // con sanitizeForLog para mejor trazabilidad en producción.
      stack: server.nodeEnv === 'production' ? err.stack?.split('\n')[1]?.trim() : err.stack,
      statusCode,
      code: errorCode,
      isOperational: err.isOperational || false,
      path: req.path,
      method: req.method,
      userId: req.user?.userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      body: req.method === 'GET' ? undefined : sanitizeForLog(req.body),
      params: sanitizeForLog(req.params),
      query: sanitizeForLog(req.query)
    };

    if (err instanceof AppError && err.isOperational) {
      logger.error('Operational error', errorContext);
    } else if (err instanceof AppError) {
      const level = _resolveBusinessLogLevel(statusCode);
      logger[level]('Business error', {
        correlationId: req.correlationId,
        message: err.message,
        statusCode,
        code: errorCode,
        path: req.path,
        userId: req.user?.userId
      });
    } else {
      logger.error('Unexpected error', errorContext);
    }
  }

  // 👇 handleError queda limpio y dentro del límite de líneas
  static handleError(rawError: unknown, req: Request, res: Response, _next: NextFunction): Response {
    // 👈 _next para satisfacer no-unused-vars (Express reconoce el handler de errores por sus 4 parámetros)
    const err = (rawError ?? {}) as HandledError;
    const statusCode = err.statusCode || 500;
    const errorCode = err.code || ERROR_CODES.INTERNAL_ERROR;

    ErrorMiddleware._logError(err, req, statusCode, errorCode);
    // El cierre de la operación (shared/observability/operation.ts) lo guarda en `operations`
    res.locals.operationError = { code: errorCode, message: err.message };

    // La auditoría registra hechos de negocio; los errores quedan en el log y en `operations`. Solo los
    // rechazos de seguridad (401/403) son además un hecho auditable.
    const securityAction = _securityAuditAction(err);
    if (securityAction) {
      auditInfraEvent({
        action: securityAction,
        actorId: req.user?.userId ?? null,
        details: { path: req.path, method: req.method, httpStatus: statusCode, errorCode, errorMessage: err.message },
        outcome: 'failure'
      });
    }

    if (rawError instanceof AppError) {
      return ErrorMiddleware._handleAppError(rawError, res, req);
    }

    const knownResponse = ErrorMiddleware._handleKnownErrors(err, res, req);
    if (knownResponse) {
      return knownResponse;
    }

    return ApiResponse.error(
      res,
      server.nodeEnv === 'production' ? ERROR_MESSAGES.INTERNAL_ERROR : (err.message ?? ERROR_MESSAGES.INTERNAL_ERROR),
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL_ERROR,
      { correlationId: req.correlationId }
    );
  }

  /**
   * Handler para rutas no encontradas — registrar antes del handleError.
   * app.use(ErrorMiddleware.handleNotFound)
   */
  static handleNotFound(req: Request, res: Response): Response {
    logger.warn('Route not found', {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      ip: req.ip
    });

    return ApiResponse.notFound(res, `Ruta no encontrada: ${req.method} ${req.path}`);
  }

  /**
   * Wrapper para controllers async — elimina la necesidad de try/catch en cada uno.
   *
   * @example
   * router.get('/users', asyncHandler(UserController.getAll));
   */
  /** Envuelve un handler async para que sus rechazos lleguen a next(err). */
  static asyncHandler(fn: AsyncRequestHandler) {
    return (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
  }

  // ==============================================
  // PRIVATE
  // ==============================================

  // Restricciones de la base (docs/prisma-migration.md, fase 5): P2002 UNIQUE → 409 con la etiqueta del
  // campo; P2003 FK → 400; P2025 fila inexistente → 404. Lo demás es un bug: 500 (permanente).
  static _handlePrismaError(err: HandledError, res: Response, correlationId: string | undefined): Response {
    switch (err.code) {
      case 'P2002': {
        const field = _prismaConstraintFields(err).find(f => FIELD_LABELS[f]);
        const label = (field && FIELD_LABELS[field]) || DEFAULT_FIELD_LABEL;
        return ApiResponse.conflict(res, `Ya existe un registro con ese ${label}`);
      }
      case 'P2003':
        return ApiResponse.badRequest(res, 'Referencia inválida');
      case 'P2025':
        return ApiResponse.notFound(res, 'Recurso no encontrado');
      default:
        return ApiResponse.error(
          res,
          'Error de base de datos',
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.DATABASE_ERROR,
          correlationId ? { correlationId } : null
        );
    }
  }
}

export default ErrorMiddleware;
