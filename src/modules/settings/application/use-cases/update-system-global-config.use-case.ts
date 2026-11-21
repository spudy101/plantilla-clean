// Caso de uso: un administrador actualiza la configuración global (parcial).
//
// Flujo: busca la activa (si no hay, la crea con defaults) → la entidad resuelve qué cambia → se guarda
// (la versión sube de forma atómica) → se audita → se avisa a los administradores sin bloquear la respuesta.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import type { Notifier } from '../../../../shared/application/ports/notifier.port';
import type { Logger } from '../../../../shared/application/ports/logger.port';
import type { SystemGlobalConfigRepository } from '../ports/system-global-config-repository.port';
import type { SystemGlobalConfigPatch } from '../../domain/system-global-config';
import { ConfigNotFoundError } from '../../domain/errors';
import { toSystemGlobalConfigOutput, type SystemGlobalConfigOutput } from '../dto/system-global-config.output';

/** Tipo de notificación que reciben los administradores cuando cambia la configuración. */
export const SYSTEM_CONFIG_UPDATED_NOTIFICATION = 'SYSTEM_CONFIG_UPDATED_INTERNAL';

export interface UpdateSystemGlobalConfigInput {
  actorId: string;
  patch: SystemGlobalConfigPatch;
}

export class UpdateSystemGlobalConfig {
  constructor(
    private readonly configs: SystemGlobalConfigRepository,
    private readonly audit: AuditTrail,
    private readonly notifier: Notifier,
    private readonly logger: Logger
  ) {}

  async execute({ actorId, patch }: UpdateSystemGlobalConfigInput): Promise<SystemGlobalConfigOutput> {
    let current = await this.configs.findActive();
    if (!current) {
      this.logger.warn('UpdateSystemGlobalConfig — no existe config activa, creando con defaults');
      current = await this.configs.createDefault();
    }

    const updated = await this.configs.applyChanges(current.id, current.changesFor(patch));
    if (!updated) {
      throw new ConfigNotFoundError();
    }

    const updatedFields = Object.keys(patch);
    await this.audit.record('SYSTEM_GLOBAL_CONFIG_UPDATED', {
      actorId,
      details: { updatedFields, configVersion: { before: current.version, after: updated.version } },
      entityId: current.id,
      entityType: 'SystemGlobalConfig',
      entityTable: 'system_global_config'
    });

    this.notifyAdmins(current.id, actorId, updatedFields, current.version, updated.version);

    this.logger.info('UpdateSystemGlobalConfig', { adminUserId: actorId, fields: updatedFields, newVersion: updated.version });
    return toSystemGlobalConfigOutput(updated);
  }

  /** Aviso a los administradores: no bloquea la respuesta, y si falla solo se loguea. */
  private notifyAdmins(configId: string, actorId: string, fields: string[], before: number, after: number): void {
    this.notifier
      .notify({
        type: SYSTEM_CONFIG_UPDATED_NOTIFICATION,
        userId: null,
        relatedEntity: { type: 'SystemGlobalConfig', id: configId },
        metadata: { camposActualizados: fields, versionAnterior: before, versionNueva: after, adminUserId: actorId }
      })
      .catch((error: unknown) =>
        this.logger.warn('Error notificando actualización de config global', {
          error: error instanceof Error ? error.message : String(error)
        })
      );
  }
}
