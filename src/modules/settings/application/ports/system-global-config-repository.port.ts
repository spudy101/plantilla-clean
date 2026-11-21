// Puerto de persistencia de la configuración global. Lo define la aplicación (lo que NECESITA), no la
// base: por eso habla de entidades del dominio y no de filas de Prisma.
//
// Implementación real: infrastructure/persistence/prisma-system-global-config.repository.ts.
// En los tests de los casos de uso se usa un doble en memoria.
import type { SystemGlobalConfig, SystemGlobalConfigChanges } from '../../domain/system-global-config';

export interface SystemGlobalConfigRepository {
  /** La configuración activa, o null si no hay. */
  findActive(): Promise<SystemGlobalConfig | null>;

  /** Crea una configuración activa con los valores por defecto. */
  createDefault(): Promise<SystemGlobalConfig>;

  /**
   * Guarda `changes` e incrementa la versión de forma atómica (no se pierde una actualización concurrente).
   * Devuelve la configuración guardada, o null si `configId` ya no existe.
   */
  applyChanges(configId: string, changes: SystemGlobalConfigChanges): Promise<SystemGlobalConfig | null>;
}
