// === RF-OPS-01: Pipeline DevSecOps, Infraestructura Base ===
// src/utils/logger.util.ts
import { interopDefault } from '../utils/interop.util';
import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import constantsModule from '../constants';
const { logging, server } = constantsModule;



// ==============================================
// SANITIZE
// ==============================================

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 10;
const MAX_DEPTH = 3;

const SENSITIVE_FIELDS = [
  'password',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'sessionId',
  'nationalId',
  'national_id',
  'email',
  'phone',
  'rut'
];

const _sanitizeValue = (key: string, value: unknown, depth: number): unknown => {
  const isSensitive = SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()));
  if (isSensitive) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }
  if (['number', 'boolean'].includes(typeof value) || value === null) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // eslint-disable-next-line no-use-before-define
  if (Array.isArray(value) || typeof value === 'object') {
    // eslint-disable-next-line no-use-before-define
    return sanitizeForLog(value, depth + 1);
  }
  return String(value);
};

// [RF-OPS-01] | CA-03 | Redacta campos sensibles (PII) antes
// de loguear — stack trace nunca expone passwords, tokens ni
// documentos de identidad.
const sanitizeForLog = (body: unknown, depth = 0): unknown => {
  if (!body || typeof body !== 'object') {
    return body;
  }
  if (depth > MAX_DEPTH) {
    return '[max depth reached]';
  }

  if (Array.isArray(body)) {
    const items: unknown[] = body.slice(0, MAX_ARRAY_LENGTH).map(item => sanitizeForLog(item, depth + 1));
    return body.length > MAX_ARRAY_LENGTH ? [...items, `...[${body.length - MAX_ARRAY_LENGTH} more items]`] : items;
  }

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    safe[key] = _sanitizeValue(key, value, depth);
  }
  return safe;
};

// ==============================================
// FORMATS
// ==============================================

// [RF-OPS-01] | CA-03 | Inyecta Correlation ID desde
// AsyncLocalStorage en cada log operacional.
// Inyecta correlationId en cada entrada de log operacional desde AsyncLocalStorage.
// Permite rastrear cualquier logger.info/warn/error hasta el request o ciclo de
// worker que lo originó. Usa get() (no getSafe()): si NO hay contexto activo
// (loggers huérfanos de arranque, eventos de Redis, bootstrap) NO se estampa
// correlationId — esos logs no pertenecen a ningún flujo.
const correlationFormat = winston.format(info => {
  const { get } = interopDefault(require('./request-context.util') as typeof import('./request-context.util'));
  const ctx = get();
  if (ctx?.correlationId && !info.correlationId) {
    info.correlationId = ctx.correlationId;
  }
  return info;
})();

// [RF-OPS-01] | CA-03 | Logger operacional con timestamp UTC
// explícito, correlation ID y sanitización de PII en logs.
const jsonFormat = winston.format.combine(
  correlationFormat,
  winston.format.timestamp({ format: () => new Date().toISOString() }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// ==============================================
// TRANSPORTS — logger operacional
// En Fargate/ECS los logs van a CloudWatch via awslogs driver.
// DailyRotateFile solo se activa en local para debugging.
// ==============================================

const isLocal = server.nodeEnv === 'development' && server.localhost === 'true';
// En producción la consola va en JSON (CloudWatch Logs Insights filtra por correlationId); en el resto,
// legible y con colores.
const isProduction = server.nodeEnv === 'production';

const transports = [
  new winston.transports.Console({
    format: isProduction ? jsonFormat : consoleFormat,
    level: logging.level || 'info'
  }),
  ...(isLocal
    ? [
        new DailyRotateFile({
          filename: path.join('/tmp/logs', 'error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          format: jsonFormat,
          maxSize: '20m',
          maxFiles: '14d',
          zippedArchive: true
        }),
        new DailyRotateFile({
          filename: path.join('/tmp/logs', 'combined-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          format: jsonFormat,
          maxSize: '20m',
          maxFiles: '14d',
          zippedArchive: true
        })
      ]
    : [])
];

// ==============================================
// LOGGER OPERACIONAL
// ==============================================

const logger = winston.createLogger({
  level: logging.level || 'info',
  format: jsonFormat,
  transports,
  exitOnError: false
});

// ==============================================
// EXPORTS
// ==============================================

export default {
  logger,
  sanitizeForLog,
  SENSITIVE_FIELDS
};
