// Puerto de logging. Los casos de uso escriben en un Logger sin saber si detrás hay winston, consola o
// nada (en tests). La implementación real es shared/infrastructure/observability/logger.util.

export type LogMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}
